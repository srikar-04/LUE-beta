import type { SessionContext } from '../types';

export function buildPineconeFilter(session: SessionContext): Record<string, unknown> {
  switch (session.role) {
    case 'admin':
      return {};

    case 'teacher':
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['teacher'] } },
              { class_id: { $in: session.class_ids ?? [] } },
            ],
          },
        ],
      };

    case 'parent':
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['parent'] } },
              { student_id: { $in: session.student_ids ?? [] } },
            ],
          },
        ],
      };

    case 'student':
      return {
        $or: [
          { access_roles: { $in: ['general'] } },
          {
            $and: [
              { access_roles: { $in: ['student'] } },
              { student_id: { $eq: session.student_id ?? '' } },
            ],
          },
        ],
      };

    default: {
      const exhaustiveCheck: never = session.role;
      throw new Error(`Unknown role: ${exhaustiveCheck}`);
    }
  }
}
