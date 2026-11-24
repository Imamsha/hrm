import type {
  AnnouncementItem,
  BadgeItem,
  CompetencyItem,
  CourseDetails,
  CourseItem,
  EnrollmentItem,
  EventItem,
  GoalCheckInItem,
  GoalItem,
  ImprovementPlanItem,
  LearningPathItem,
  MyRecognitionSummary,
  MyReviewTask,
  PaginatedResult,
  ParticipantItem,
  RatingScaleItem,
  RecognitionItem,
  RedemptionItem,
  ReviewCycleItem,
  ReviewDetails,
  ReviewTemplateItem,
  RewardItem,
  SkillMatrixItem,
  SuggestionItem,
  SurveyItem,
  SurveyResultItem,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const TALENT = ['talent'] as const;
const q = <T>(
  key: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  enabled = true,
) => ({
  queryKey: [...TALENT, key, path, query ?? {}],
  queryFn: () => api.get<T>(path, query ? { query } : undefined),
  enabled,
});

export const useScales = () => useQuery(q<RatingScaleItem[]>('scales', '/performance/scales'));
export const useCompetencies = () =>
  useQuery(q<CompetencyItem[]>('competencies', '/performance/competencies'));
export const useTemplates = () =>
  useQuery(q<ReviewTemplateItem[]>('templates', '/performance/templates'));
export const useCycles = () => useQuery(q<ReviewCycleItem[]>('cycles', '/performance/cycles'));
export const useParticipants = (cycleId: string) =>
  useQuery(
    q<ParticipantItem[]>(
      'participants',
      `/performance/cycles/${cycleId}/participants`,
      undefined,
      !!cycleId,
    ),
  );
export const useDistribution = (cycleId: string, enabled: boolean) =>
  useQuery(
    q<{ value: string; label: string; count: number; percent: string }[]>(
      'distribution',
      `/performance/cycles/${cycleId}/distribution`,
      undefined,
      enabled && !!cycleId,
    ),
  );
export const useReview = (id: string) =>
  useQuery(q<ReviewDetails>('review', `/performance/reviews/${id}`));
export const useMyTasks = () => useQuery(q<MyReviewTask[]>('tasks', '/me/review-tasks'));
export const useMyReviews = () => useQuery(q<ParticipantItem[]>('my-reviews', '/me/reviews'));
export const useGoals = (query: Record<string, string | number | undefined>) =>
  useQuery<PaginatedResult<GoalItem>>({
    queryKey: [...TALENT, 'goals', query],
    queryFn: () => api.getPage<GoalItem>('/goals', { query }),
    placeholderData: keepPreviousData,
  });
export const useGoalHistory = (id: string | null) =>
  useQuery(q<GoalCheckInItem[]>('goal-history', `/goals/${id ?? ''}/check-ins`, undefined, !!id));
export const usePips = () => useQuery(q<ImprovementPlanItem[]>('pips', '/performance/pips'));

export const useCourses = () => useQuery(q<CourseItem[]>('courses', '/learning/courses'));
export const useCourse = (id: string) =>
  useQuery(q<CourseDetails>('course', `/learning/courses/${id}`));
export const usePaths = () => useQuery(q<LearningPathItem[]>('paths', '/learning/paths'));
export const useMyLearning = () => useQuery(q<EnrollmentItem[]>('my-learning', '/me/learning'));
export const useEnrollments = (query: Record<string, string | undefined>) =>
  useQuery(q<EnrollmentItem[]>('enrollments', '/learning/enrollments', query));
export const useSkillMatrix = (days: number) =>
  useQuery(q<SkillMatrixItem>('matrix', '/learning/skill-matrix', { days }));

export const useSurveys = () => useQuery(q<SurveyItem[]>('surveys', '/engagement/surveys'));
export const useSurveyResults = (id: string | null) =>
  useQuery(
    q<SurveyResultItem>(
      'survey-results',
      `/engagement/surveys/${id ?? ''}/results`,
      undefined,
      !!id,
    ),
  );
export const useBadges = () => useQuery(q<BadgeItem[]>('badges', '/engagement/badges'));
export const useFeed = () => useQuery(q<RecognitionItem[]>('feed', '/engagement/recognitions'));
export const useMyRecognition = () =>
  useQuery(q<MyRecognitionSummary>('my-recognition', '/me/recognition'));
export const useRewards = () => useQuery(q<RewardItem[]>('rewards', '/engagement/rewards'));
export const useRedemptions = (enabled: boolean) =>
  useQuery(q<RedemptionItem[]>('redemptions', '/engagement/redemptions', undefined, enabled));
export const useAnnouncements = (all: boolean) =>
  useQuery(
    q<AnnouncementItem[]>(
      'announcements',
      '/engagement/announcements',
      all ? { all: true } : undefined,
    ),
  );
export const useEvents = () => useQuery(q<EventItem[]>('events', '/engagement/events'));
export const useSuggestions = () =>
  useQuery(q<SuggestionItem[]>('suggestions', '/engagement/suggestions'));

export const ROLE_LABEL: Record<string, string> = {
  SELF: 'Self-review',
  MANAGER: 'Manager review',
  PEER: 'Peer feedback',
  UPWARD: 'Upward feedback',
};
export const TALENT_VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  DRAFT: 'neutral',
  OPEN: 'info',
  CALIBRATION: 'warning',
  CLOSED: 'success',
  PENDING: 'warning',
  SUBMITTED: 'success',
  DECLINED: 'neutral',
  ACTIVE: 'info',
  ACHIEVED: 'success',
  MISSED: 'destructive',
  CANCELLED: 'neutral',
  PASSED: 'success',
  FAILED: 'destructive',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
  ENROLLED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  WITHDRAWN: 'neutral',
  NEW: 'info',
  UNDER_REVIEW: 'warning',
  ACCEPTED: 'primary',
  IMPLEMENTED: 'success',
  FULFILLED: 'success',
  REJECTED: 'destructive',
};
export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
export const uid = () => Math.random().toString(36).slice(2, 8);
