import { Injectable } from '@nestjs/common';
import {
  certificationExpiry,
  courseProgress,
  gradeQuiz,
  publicQuestions,
  type QuizQuestion,
} from '@hrm/business-rules';
import {
  type CourseDetails,
  type CourseItem,
  type CourseModuleItem,
  type EnrollmentItem,
  type LearningPathItem,
  PERMISSIONS,
  type QuizResultItem,
  type SkillMatrixItem,
} from '@hrm/shared-types';
import type {
  courseFeedbackSchema,
  courseSchema,
  learningAssignmentSchema,
  learningPathSchema,
  quizAttemptSchema,
  updateCourseSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { isoDate, isoOrNull, toDate, todayIso } from '../employees/employee-scope.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import {
  audienceEmployees,
  dec,
  directReports,
  empSelect,
  myEmployeeId,
  ref,
  requireMe,
} from './talent-common.js';

const P = PERMISSIONS;
const enrollmentInclude = {
  course: { select: { id: true, code: true, title: true, _count: { select: { modules: true } } } },
  employee: { select: empSelect },
} satisfies Prisma.EnrollmentInclude;
type EnrollmentRow = Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async enrollmentItem(tx: TenantTransaction, e: EnrollmentRow): Promise<EnrollmentItem> {
    const cert = e.certificationId
      ? await tx.employeeCertification.findFirst({
          where: { id: e.certificationId },
          select: { expiresOn: true },
        })
      : null;
    return {
      id: e.id,
      course: {
        id: e.course.id,
        code: e.course.code,
        title: e.course.title,
        moduleCount: e.course._count.modules,
      },
      employee: ref(e.employee),
      source: e.source,
      dueOn: isoOrNull(e.dueOn),
      status: e.status,
      completedModules: e.completedModules,
      progress:
        e.status === 'COMPLETED'
          ? 100
          : courseProgress(e.completedModules.length, e.course._count.modules),
      scorePercent: dec(e.scorePercent),
      completedAt: e.completedAt?.toISOString() ?? null,
      certificationExpiresOn: isoOrNull(cert?.expiresOn),
      overdue:
        !!e.dueOn &&
        e.status !== 'COMPLETED' &&
        e.status !== 'WITHDRAWN' &&
        isoDate(e.dueOn) < todayIso(),
    };
  }

  // ------------------------------------------------------------------------------ courses

  courses(principal: AuthPrincipal): Promise<CourseItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const manage = can(principal, P.LEARNING_COURSE_MANAGE, {});
      const rows = await tx.course.findMany({
        where: manage ? {} : { status: 'PUBLISHED' },
        orderBy: { title: 'asc' },
        include: { _count: { select: { modules: true } } },
      });
      const counts = await tx.enrollment.groupBy({
        by: ['courseId', 'status'],
        where: { courseId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      });
      return rows.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        format: c.format,
        durationMinutes: c.durationMinutes,
        passPercent: c.passPercent,
        certificationValidityMonths: c.certificationValidityMonths,
        skills: c.skills,
        status: c.status,
        moduleCount: c._count.modules,
        enrolled: counts
          .filter((x) => x.courseId === c.id && x.status !== 'WITHDRAWN')
          .reduce((a, x) => a + x._count._all, 0),
        completed: counts
          .filter((x) => x.courseId === c.id && x.status === 'COMPLETED')
          .reduce((a, x) => a + x._count._all, 0),
      }));
    });
  }

  course(principal: AuthPrincipal, id: string): Promise<CourseDetails> {
    return this.prisma.withTenant(async (tx) => this.courseIn(tx, principal, id));
  }

  private async courseIn(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<CourseDetails> {
    const manage = can(principal, P.LEARNING_COURSE_MANAGE, {});
    const c = await tx.course.findFirst({
      where: { id, ...(manage ? {} : { status: 'PUBLISHED' }) },
      include: { modules: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!c) throw AppException.notFound('Course');
    const me = await myEmployeeId(tx, principal);
    const mine = me
      ? await tx.enrollment.findFirst({
          where: { courseId: id, employeeId: me, status: { not: 'WITHDRAWN' } },
          include: enrollmentInclude,
        })
      : null;
    const [list] = await Promise.all([this.courses(principal)]);
    const summary = list.find((x) => x.id === id);
    return {
      ...(summary ?? {
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        format: c.format,
        durationMinutes: c.durationMinutes,
        passPercent: c.passPercent,
        certificationValidityMonths: c.certificationValidityMonths,
        skills: c.skills,
        status: c.status,
        moduleCount: c.modules.length,
        enrolled: 0,
        completed: 0,
      }),
      modules: c.modules.map((m): CourseModuleItem => ({
        id: m.id,
        title: m.title,
        type: m.type,
        content: m.content,
        url: m.url,
        // Learners never receive the correct answers.
        questions: manage
          ? (m.questions as unknown as QuizQuestion[])
          : publicQuestions(m.questions as unknown as QuizQuestion[]),
      })),
      myEnrollment: mine ? await this.enrollmentItem(tx, mine) : null,
    };
  }

  createCourse(
    principal: AuthPrincipal,
    input: z.output<typeof courseSchema>,
  ): Promise<CourseDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      try {
        const c = await tx.course.create({
          data: {
            organizationId,
            code: input.code,
            title: input.title,
            description: input.description ?? null,
            format: input.format,
            durationMinutes: input.durationMinutes ?? null,
            passPercent: input.passPercent,
            certificationValidityMonths: input.certificationValidityMonths ?? null,
            skills: input.skills,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await tx.courseModule.createMany({
          data: input.modules.map((m, i) => ({
            organizationId,
            courseId: c.id,
            sortOrder: i,
            title: m.title,
            type: m.type,
            content: m.content ?? null,
            url: m.url,
            questions: m.questions,
          })),
        });
        await this.audit.record(tx, {
          action: 'learning.course.created',
          entityType: 'course',
          entityId: c.id,
          metadata: { code: input.code },
        });
        return await this.courseIn(tx, principal, c.id);
      } catch (err) {
        if (err instanceof AppException) throw err;
        mapWriteError(err, { entity: 'course', uniqueField: 'code' });
      }
    });
  }

  updateCourse(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof updateCourseSchema>,
  ): Promise<CourseDetails> {
    return this.prisma.withTenant(async (tx) => {
      const c = await tx.course.findFirst({ where: { id }, select: { status: true } });
      if (!c) throw AppException.notFound('Course');
      if (c.status === 'ARCHIVED' && input.status && input.status !== 'ARCHIVED')
        throw AppException.conflict('An archived course stays archived');
      await tx.course.update({ where: { id }, data: definedOnly(input) });
      if (input.status)
        await this.audit.record(tx, {
          action: `learning.course.${input.status.toLowerCase()}`,
          entityType: 'course',
          entityId: id,
        });
      return this.courseIn(tx, principal, id);
    });
  }

  // ------------------------------------------------------------------------------ paths

  paths(): Promise<LearningPathItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.learningPath.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        include: {
          courses: {
            orderBy: { sortOrder: 'asc' },
            include: { course: { select: { id: true, code: true, title: true } } },
          },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        courses: p.courses.map((c) => c.course),
      }));
    });
  }

  createPath(
    principal: AuthPrincipal,
    input: z.output<typeof learningPathSchema>,
  ): Promise<LearningPathItem[]> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma
      .withTenant(async (tx) => {
        const found = await tx.course.count({
          where: { id: { in: input.courseIds }, status: 'PUBLISHED' },
        });
        if (found !== new Set(input.courseIds).size)
          throw AppException.badRequest('Only published courses can be in a path', 'courseIds');
        try {
          const p = await tx.learningPath.create({
            data: { organizationId, name: input.name, description: input.description ?? null },
            select: { id: true },
          });
          await tx.learningPathCourse.createMany({
            data: [...new Set(input.courseIds)].map((courseId, i) => ({
              organizationId,
              pathId: p.id,
              courseId,
              sortOrder: i,
            })),
          });
        } catch (err) {
          if (err instanceof AppException) throw err;
          mapWriteError(err, { entity: 'learning path', uniqueField: 'name' });
        }
      })
      .then(() => this.paths());
  }

  // ------------------------------------------------------------------------------ enrolment

  private async enroll(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeIds: string[],
    courseIds: string[],
    source: 'SELF' | 'ASSIGNED' | 'PATH',
    extra: { pathId?: string | null; dueOn?: string | null },
  ): Promise<number> {
    let created = 0;
    for (const employeeId of employeeIds)
      for (const courseId of courseIds) {
        const existing = await tx.enrollment.findFirst({
          where: { courseId, employeeId, status: { not: 'WITHDRAWN' } },
          select: { id: true, dueOn: true },
        });
        if (existing) {
          // Re-assignment can set an earlier due date but never removes progress.
          if (extra.dueOn && (!existing.dueOn || isoDate(existing.dueOn) > extra.dueOn))
            await tx.enrollment.update({
              where: { id: existing.id },
              data: { dueOn: toDate(extra.dueOn) },
            });
          continue;
        }
        await tx.enrollment.create({
          data: {
            organizationId: principal.organizationId ?? '',
            courseId,
            employeeId,
            source,
            pathId: extra.pathId ?? null,
            assignedByUserId: source === 'SELF' ? null : principal.userId,
            dueOn: extra.dueOn ? toDate(extra.dueOn) : null,
          },
        });
        created += 1;
      }
    return created;
  }

  selfEnroll(principal: AuthPrincipal, courseId: string): Promise<CourseDetails> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const c = await tx.course.findFirst({
        where: { id: courseId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (!c) throw AppException.notFound('Course');
      await this.enroll(tx, principal, [me], [courseId], 'SELF', {});
      return this.courseIn(tx, principal, courseId);
    });
  }

  /** Assigns a course or path to employees or an audience (HR), or to direct reports (managers). */
  assign(
    principal: AuthPrincipal,
    input: z.output<typeof learningAssignmentSchema>,
  ): Promise<{ assigned: number; employees: number }> {
    return this.prisma.withTenant(
      async (tx) => {
        const hr = can(principal, P.LEARNING_ASSIGNMENT_MANAGE, {});
        let employees = [...new Set(input.employeeIds)];
        if (input.audience && (input.audience.companyId || input.audience.departmentId)) {
          if (!hr)
            throw AppException.forbidden(
              'Assigning to a company or department needs learning.assignment.manage',
            );
          employees = [
            ...new Set([
              ...employees,
              ...(await audienceEmployees(tx, input.audience)).map((e) => e.id),
            ]),
          ];
        }
        if (!hr) {
          const me = await requireMe(tx, principal);
          const team = new Set(await directReports(tx, me));
          if (employees.some((e) => !team.has(e)))
            throw AppException.forbidden('Managers can assign learning to their direct reports');
        }
        let courseIds: string[];
        if (input.pathId) {
          const p = await tx.learningPath.findFirst({
            where: { id: input.pathId },
            include: { courses: { orderBy: { sortOrder: 'asc' } } },
          });
          if (!p) throw AppException.badRequest('The learning path does not exist', 'pathId');
          courseIds = p.courses.map((c) => c.courseId);
        } else {
          const c = await tx.course.findFirst({
            where: { id: input.courseId ?? '', status: 'PUBLISHED' },
            select: { id: true },
          });
          if (!c)
            throw AppException.badRequest('Only published courses can be assigned', 'courseId');
          courseIds = [c.id];
        }
        const found = await tx.employee.count({
          where: { id: { in: employees }, status: { not: 'SEPARATED' } },
        });
        if (found !== employees.length)
          throw AppException.badRequest(
            'A selected employee does not exist or has left',
            'employeeIds',
          );
        const assigned = await this.enroll(
          tx,
          principal,
          employees,
          courseIds,
          input.pathId ? 'PATH' : 'ASSIGNED',
          { pathId: input.pathId, dueOn: input.dueOn },
        );
        await this.audit.record(tx, {
          action: 'learning.assigned',
          entityType: input.pathId ? 'learning_path' : 'course',
          entityId: input.pathId ?? input.courseId ?? null,
          metadata: { employees: employees.length, enrollments: assigned },
        });
        return { assigned, employees: employees.length };
      },
      { timeoutMs: 60_000 },
    );
  }

  myLearning(principal: AuthPrincipal): Promise<EnrollmentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const rows = await tx.enrollment.findMany({
        where: { employeeId: me, status: { not: 'WITHDRAWN' } },
        orderBy: [{ dueOn: 'asc' }, { createdAt: 'desc' }],
        include: enrollmentInclude,
      });
      return Promise.all(rows.map((r) => this.enrollmentItem(tx, r)));
    });
  }

  enrollments(
    principal: AuthPrincipal,
    q: { courseId?: string; employeeId?: string; status?: string },
  ): Promise<EnrollmentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const hr = can(principal, P.LEARNING_ASSIGNMENT_MANAGE, {});
      let scope: Prisma.EnrollmentWhereInput = {};
      if (!hr) {
        const me = await requireMe(tx, principal);
        scope = { employeeId: { in: await directReports(tx, me) } };
      }
      const rows = await tx.enrollment.findMany({
        where: {
          ...scope,
          ...(q.courseId ? { courseId: q.courseId } : {}),
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
          ...(q.status ? { status: q.status as EnrollmentRow['status'] } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: enrollmentInclude,
      });
      return Promise.all(rows.map((r) => this.enrollmentItem(tx, r)));
    });
  }

  private async myEnrollment(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    enrollmentId: string,
  ) {
    const me = await requireMe(tx, principal);
    const e = await tx.enrollment.findFirst({
      where: { id: enrollmentId, employeeId: me },
      include: {
        ...enrollmentInclude,
        course: {
          include: {
            modules: { orderBy: { sortOrder: 'asc' } },
            _count: { select: { modules: true } },
          },
        },
      },
    });
    if (!e) throw AppException.notFound('Enrollment');
    if (e.status === 'WITHDRAWN' || e.status === 'COMPLETED')
      throw AppException.conflict(`This enrollment is ${e.status.toLowerCase()}`);
    return e;
  }

  /** Marks a content module done; completes the course when every module is done (and quizzes passed). */
  completeModule(
    principal: AuthPrincipal,
    enrollmentId: string,
    moduleId: string,
  ): Promise<EnrollmentItem> {
    return this.prisma.withTenant(async (tx) => {
      const e = await this.myEnrollment(tx, principal, enrollmentId);
      const m = e.course.modules.find((x) => x.id === moduleId);
      if (!m) throw AppException.notFound('Module');
      if (m.type === 'QUIZ') throw AppException.conflict('A quiz is completed by passing it');
      return this.progress(
        tx,
        principal,
        e.id,
        [...new Set([...e.completedModules, moduleId])],
        null,
      );
    });
  }

  attemptQuiz(
    principal: AuthPrincipal,
    enrollmentId: string,
    moduleId: string,
    input: z.output<typeof quizAttemptSchema>,
  ): Promise<QuizResultItem> {
    return this.prisma.withTenant(async (tx) => {
      const e = await this.myEnrollment(tx, principal, enrollmentId);
      const m = e.course.modules.find((x) => x.id === moduleId);
      if (m?.type !== 'QUIZ') throw AppException.notFound('Quiz');
      const result = gradeQuiz(
        m.questions as unknown as QuizQuestion[],
        input.answers,
        e.course.passPercent,
      );
      await tx.quizAttempt.create({
        data: {
          organizationId: principal.organizationId ?? '',
          enrollmentId,
          moduleId,
          answers: input.answers,
          scorePercent: result.percent.toFixed(2),
          passed: result.passed,
        },
      });
      const done = result.passed
        ? [...new Set([...e.completedModules, moduleId])]
        : e.completedModules;
      const enrollment = await this.progress(
        tx,
        principal,
        e.id,
        done,
        result.passed ? result.percent.toFixed(2) : null,
      );
      return {
        scorePercent: result.percent.toFixed(2),
        passed: result.passed,
        perQuestion: result.perQuestion,
        enrollment,
      };
    });
  }

  /**
   * Saves progress; on completion issues the certification (with expiry) and adds the course's
   * skills the employee does not have yet.
   */
  private async progress(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    enrollmentId: string,
    completed: string[],
    quizScore: string | null,
  ): Promise<EnrollmentItem> {
    const e = await tx.enrollment.findFirst({
      where: { id: enrollmentId },
      include: { course: { include: { modules: { select: { id: true } } } } },
    });
    if (!e) throw AppException.notFound('Enrollment');
    const all = e.course.modules.map((m) => m.id);
    const finished = all.every((id) => completed.includes(id));
    const data: Prisma.EnrollmentUpdateInput = {
      completedModules: completed,
      status: finished ? 'COMPLETED' : 'IN_PROGRESS',
      ...(quizScore ? { scorePercent: quizScore } : {}),
    };
    if (finished) {
      const today = todayIso();
      data.completedAt = new Date();
      if (e.course.certificationValidityMonths) {
        const cert = await tx.employeeCertification.create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId: e.employeeId,
            name: e.course.title,
            issuer: 'Internal learning',
            issuedOn: toDate(today),
            expiresOn: toDate(certificationExpiry(today, e.course.certificationValidityMonths)),
          },
          select: { id: true },
        });
        data.certificationId = cert.id;
      }
      for (const skill of e.course.skills) {
        const has = await tx.employeeSkill.findFirst({
          where: { employeeId: e.employeeId, name: { equals: skill, mode: 'insensitive' } },
          select: { id: true },
        });
        if (!has)
          await tx.employeeSkill.create({
            data: {
              organizationId: principal.organizationId ?? '',
              employeeId: e.employeeId,
              name: skill,
              level: 'BEGINNER',
            },
          });
      }
      await this.audit.record(tx, {
        action: 'learning.course.completed',
        entityType: 'enrollment',
        entityId: enrollmentId,
        metadata: { courseId: e.courseId },
      });
    }
    const out = await tx.enrollment.update({
      where: { id: enrollmentId },
      data,
      include: enrollmentInclude,
    });
    return this.enrollmentItem(tx, out);
  }

  feedback(
    principal: AuthPrincipal,
    enrollmentId: string,
    input: z.output<typeof courseFeedbackSchema>,
  ): Promise<EnrollmentItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const e = await tx.enrollment.findFirst({
        where: { id: enrollmentId, employeeId: me },
        select: { id: true },
      });
      if (!e) throw AppException.notFound('Enrollment');
      const out = await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { feedbackRating: input.rating, feedbackComment: input.comment ?? null },
        include: enrollmentInclude,
      });
      return this.enrollmentItem(tx, out);
    });
  }

  withdraw(principal: AuthPrincipal, enrollmentId: string): Promise<EnrollmentItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const e = await tx.enrollment.findFirst({
          where: { id: enrollmentId, employeeId: me },
          select: { source: true, status: true },
        });
        if (!e) throw AppException.notFound('Enrollment');
        if (e.source !== 'SELF')
          throw AppException.conflict('Assigned learning cannot be withdrawn by the learner');
        if (e.status === 'COMPLETED')
          throw AppException.conflict('A completed course cannot be withdrawn');
        await tx.enrollment.update({ where: { id: enrollmentId }, data: { status: 'WITHDRAWN' } });
      })
      .then(() => this.myLearning(principal));
  }

  /** Employees × skills (Phase 04 skills) and certifications expiring within `days`. */
  skillMatrix(principal: AuthPrincipal, days: number): Promise<SkillMatrixItem> {
    return this.prisma.withTenant(async (tx) => {
      const hr = can(principal, P.LEARNING_ASSIGNMENT_MANAGE, {});
      let ids: string[] | null = null;
      if (!hr) {
        const me = await requireMe(tx, principal);
        ids = await directReports(tx, me);
      }
      const employees = await tx.employee.findMany({
        where: { status: { not: 'SEPARATED' }, ...(ids ? { id: { in: ids } } : {}) },
        orderBy: { employeeNumber: 'asc' },
        take: 500,
        select: { ...empSelect, skills: { select: { name: true, level: true } } },
      });
      const skills = [
        ...new Set(employees.flatMap((e) => e.skills.map((s) => s.name.toLowerCase()))),
      ].sort();
      const until = new Date(Date.now() + days * 86_400_000);
      const certs = await tx.employeeCertification.findMany({
        where: {
          expiresOn: { not: null, lte: until },
          employeeId: { in: employees.map((e) => e.id) },
        },
        orderBy: { expiresOn: 'asc' },
        include: { employee: { select: empSelect } },
      });
      return {
        skills,
        rows: employees.map((e) => ({
          employee: ref(e),
          levels: Object.fromEntries(e.skills.map((s) => [s.name.toLowerCase(), s.level])),
        })),
        expiringCertifications: certs.map((c) => ({
          employee: ref(c.employee),
          name: c.name,
          expiresOn: isoDate(c.expiresOn ?? new Date()),
        })),
      };
    });
  }
}
