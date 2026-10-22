// All bot modules. Order matters only for /hilfe output.
import setup from './setup.js';
import applications from './applications.js';
import invites from './invites.js';
import creator from './creator.js';
import live from './live.js';
import leaderboard from './leaderboard.js';
import playtests from './playtests.js';
import bugs from './bugs.js';
import events from './events.js';
import help from './help.js';

export const MODULES = [setup, applications, invites, creator, live, leaderboard, playtests, bugs, events, help];
