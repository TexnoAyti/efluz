import fs from 'node:fs';
const path = 'src/components/EflCareerCard.tsx';
let text = fs.readFileSync(path, 'utf8');
const replacements = [
  [
    "} from '../lib/premiumApi';\n\nconst SEASON_ID",
    "} from '../lib/premiumApi';\nimport { PremiumSmartAlertsPanel } from './PremiumSmartAlertsPanel';\n\nconst SEASON_ID"
  ],
  [
    "type LabTab = 'career' | 'access' | 'checkout';",
    "type LabTab = 'career' | 'access' | 'alerts' | 'checkout';"
  ],
  [
    "          <LabTabButton active={tab === 'access'} onClick={() => setTab('access')} icon={<UserRoundCheck className=\"h-3.5 w-3.5\" />} label=\"Access Control\" />\n          <LabTabButton active={tab === 'checkout'}",
    "          <LabTabButton active={tab === 'access'} onClick={() => setTab('access')} icon={<UserRoundCheck className=\"h-3.5 w-3.5\" />} label=\"Access Control\" />\n          <LabTabButton active={tab === 'alerts'} onClick={() => setTab('alerts')} icon={<Sparkles className=\"h-3.5 w-3.5\" />} label=\"Smart Alerts\" />\n          <LabTabButton active={tab === 'checkout'}"
  ],
  [
    "            {tab === 'checkout' && (",
    "            {tab === 'alerts' && selectedUserId && (\n              <PremiumSmartAlertsPanel\n                userId={selectedUserId}\n                username={selectedUser?.username}\n                entitlementActive={activeEntitlement}\n              />\n            )}\n\n            {tab === 'checkout' && ("
  ],
];
for (const [from, to] of replacements) {
  if (!text.includes(from)) throw new Error(`Pattern missing: ${from.slice(0, 120)}`);
  text = text.replace(from, to);
}
fs.writeFileSync(path, text);
console.log('Premium Smart Alerts tab integrated.');
