// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// One device per location UID of the configuration. External ids (forever):
//   ext:<selector>:location:<uid>         the device
//   ext:<selector>:location:<uid>:level   its alert level, 0 to 3
// The UID is the one of alerts.in.ua: it never changes for a location.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { LEVEL } from './constants.js';
import { locationName } from './locations.js';

export const DEVICE_TYPE = 'location';
export const FEATURE = { level: 'level' };

export const idsOf = (gladys, uid) => gladys.externalIds(DEVICE_TYPE, String(uid));

/** The UID of a device of this integration, else undefined. */
export function uidOf(externalId) {
  const match = /:location:(\d{1,4})$/.exec(String(externalId ?? ''));
  return match ? Number(match[1]) : undefined;
}

export function buildDevice(gladys, uid) {
  const ids = idsOf(gladys, uid);
  return {
    name: `Alerts: ${locationName(uid)}`,
    external_id: ids.device,
    features: [
      {
        name: 'Alert level',
        external_id: ids.feature(FEATURE.level),
        category: C.RISK,
        type: T.RISK.INTEGER,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: LEVEL.NONE,
        max: LEVEL.RED,
      },
    ],
    params: [{ name: 'uid', value: String(uid) }],
  };
}

export function levelState(gladys, uid, level) {
  return { device_feature_external_id: idsOf(gladys, uid).feature(FEATURE.level), state: level };
}
