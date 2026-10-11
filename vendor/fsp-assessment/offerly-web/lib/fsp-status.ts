import type { FspStatus } from '../../src/domain.js';

/** Return only explicitly modeled demo achievements; never imply official verification. */
export function modeledFspStatus(id: string | null | undefined): FspStatus | null {
  const competition = (
    {
      'FSP-DEMO-1042': 'Призёр соревнований ФСП',
      'FSP-DEMO-1045': 'Участник соревнований ФСП',
      'FSP-DEMO-1046': 'Призёр соревнований ФСП',
    } as Record<string, string>
  )[id || ''];
  return competition
    ? {
        id: id!,
        verified: false,
        modeled: true,
        competition,
        achievements: [`${competition} · модель данных хакатона`],
      }
    : null;
}
