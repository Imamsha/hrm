# ADR-016: Performance, learning and engagement

- Status: Accepted (2026-11-24, Phase 09) — assumptions below await owner confirmation
- Builds on: [ADR-011](ADR-011-employee-management.md) (employees, reporting managers, skills,
  certifications), [ADR-010](ADR-010-organization-structure-and-scoped-access.md) (structure for
  audiences)

## Context

Phase 09 covers three areas:

- **Performance management:** review cycles, goals, OKRs and KPIs, self/manager/peer/upward
  (360°) feedback, competencies, ratings, calibration, improvement plans (PIPs) and promotion
  recommendations.
- **Learning:** courses, quizzes, learning paths, assignments, certifications and the skill
  matrix.
- **Engagement:** surveys and pulse surveys, recognition and rewards, announcements, events and
  suggestions.

The master rules say AI is never the sole decision-maker for promotion, compensation or
discipline. Anonymous feedback must remain anonymous.

## Decisions

### Performance

- **Configuration, not assumptions.** Rating scales (points, labels), competencies and review
  templates are the organization's own. Templates set the goals/competency weighting, the
  competencies and questions, and which reviewer roles take part. Nothing is seeded.
- **Goals.** Goals belong to an employee, a department or the organization. They can align
  upward to a parent goal, forming an OKR cascade.
  - **Measurement:** a KPI is a metric with start, target and current values, measured towards a
    higher or a lower target. An OKR objective is the weighted average of its key results; a
    simple goal is reported as a percentage.
  - **Check-ins:** an append-only history of progress updates.
- **Review cycles.** Status: DRAFT → OPEN → CALIBRATION → CLOSED.
  - **Launching** snapshots the participants in scope and each one's reporting manager at that
    moment.
  - **Reviewers:** a participant has one SELF and one MANAGER response, PEER responses
    (nominated, minimum and maximum set by the template), and optional UPWARD responses from
    direct reports.
  - **Scores:** the weighted score is a pure function of goal achievement and competency ratings,
    mapped to the nearest point on the organization's scale.
  - **Calibration:** HR may change a final rating, always with a recorded reason.
  - **Release:** closing the cycle releases final results to employees, who acknowledge them.
- **Feedback visibility.**
  - Managers and HR see attributed responses.
  - Employees see their own self-review at any time.
  - After release, employees see peer and upward feedback **only as an aggregate without names**,
    and only when the number of responses reaches the template's minimum.
- **Promotion recommendations** are recorded by the manager with a justification for HR. They
  never change a job, grade or salary automatically.
- **Improvement plans (PIPs)** have objectives, check-ins and an outcome. They are visible only to
  the employee, their manager and HR (`performance.pip.manage`).

### Learning

- **Courses** are links or text content in modules, with optional auto-graded quizzes. Correct
  answers are never sent to learners. Each course has a pass mark, an optional certification
  validity and the skills it develops.
- **Learning paths** are ordered courses. Assigning a path enrols in all its courses.
- **Enrolment** happens by self-enrolment or by assignment (to employees, or to a company or
  department), with a due date. Progress is the share of completed modules.
- **Quiz attempts** are append-only.
- **Completion** at or above the pass mark marks the enrolment completed. Where a validity is
  set, it creates a Phase 04 **employee certification** with an expiry date. It also adds the
  course's skills to the employee's skills (proficiency "beginner") when they are missing.
- **Skill matrix:** a report of employees × skills from the Phase 04 skills data, plus a list of
  certifications expiring soon.

### Engagement

- **Surveys and pulses** have typed questions: rating 1–5, eNPS 0–10, single choice and text.
  Each has an audience (everyone, a company or a department) and opening and closing times.
  - **Anonymous surveys:** responses store **no employee id**, and the database refuses a
    response with an employee id on an anonymous survey. Invitations record only _whether_
    someone responded, so reminders work without linking answers to people.
  - **Minimum group size:** results, including department breakdowns, are hidden when the group
    has fewer responses than the survey's minimum. The creator sets the minimum; none is assumed.
  - eNPS is the standard formula: % promoters (9–10) − % detractors (0–6).
- **Recognition:**
  - colleagues send each other organization-defined badges, optionally worth points;
  - a rewards catalogue lets employees redeem points, and HR fulfils redemptions;
  - there is no payroll or tax link (an organization that wants one uses a payroll adjustment).
- **Announcements:** for an audience, optionally pinned, with read tracking and optional
  acknowledgement.
- **Events:** with RSVP and optional capacity.
- **Suggestions:** can be anonymous; one vote per person; a status workflow with an official
  response.

### As built

- Migration `20261125000000_performance_learning_engagement`: 29 tenant tables with RLS,
  composite same-tenant keys, `app.review_cycle_guard` (closed cycles never change),
  `app.survey_response_guard` (anonymous ⇒ no employee id; named ⇒ required),
  `suggestions_author_chk`, partial unique live enrollment, append-only goal/PIP check-ins,
  quiz attempts, survey responses and recognitions; 9 permissions granted to owner, admin and HR
  admin.
- `modules/talent`: performance, learning and engagement services behind three controllers.
  Launching a cycle snapshots the template **and its scale**; the review page reads that snapshot.
- Privacy hardening found in testing: anonymous survey responses and suggestions use a random v4
  id and a day-only timestamp (time-ordered v7 ids and exact times could re-identify people), and
  anonymous suggestions write no audit entry naming the author.
- Required review questions apply to every reviewer role, including peers.
- Web: goals & OKRs, reviews (tasks, response form, peer nomination, calibration,
  acknowledgement), review cycles, performance setup, improvement plans, my learning with the
  catalogue, course player with quizzes, learning admin (course/quiz editor, paths, assignments,
  enrollments, skill matrix), company home (announcements, events, recognition, rewards),
  surveys (editor, answering, results), suggestions, engagement admin.
- `ResourceForm` gained a `transform` prop so flat form values become nested API bodies
  (measures, audiences, ISO datetimes) **before** the shared schema validates them.

## Assumptions (to confirm with the owner)

1. Rating scales, weights, competencies, the anonymity minimum and points values are configured by
   the organization; none are pre-loaded.
2. AI writing help (review drafts, summaries) is deferred to Phase 12 (AI platform). AI never
   rates, ranks or recommends promotion.
3. Course content is links and text. SCORM/xAPI and external learning platforms are integrations
   (Phase 15).
4. Rewards carry no monetary or tax treatment in this phase.
5. Performance permissions are organization-wide for HR. Managers act on their direct reports
   through the reporting line.
