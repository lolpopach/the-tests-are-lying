import { hardcodedCredential, publicEnvSecret } from './secrets.js';
import { envCommitted, gitignoreMissingEnv } from './git-hygiene.js';
import { unauthenticatedWrite, openCors, firebaseOpenRules } from './open-backend.js';
import { meteredEndpointUnprotected } from './cost.js';
import { debugEndpointShipped, sqlStringBuilding, secretLogged } from './leftovers.js';

/**
 * Every check nomoretime knows about, in the order a person would want to
 * hear them: what is already public, then what is open, then what is left over.
 */
export const RULES = [
  hardcodedCredential,
  publicEnvSecret,
  envCommitted,
  firebaseOpenRules,
  meteredEndpointUnprotected,
  unauthenticatedWrite,
  sqlStringBuilding,
  openCors,
  secretLogged,
  debugEndpointShipped,
  gitignoreMissingEnv,
];

export const RULE_IDS = RULES.map((r) => r.id);
