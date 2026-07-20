import { OneCLI } from '@onecli-sh/sdk';
import { readEnvFile } from '../src/env.js';
import { ONECLI_URL, ONECLI_API_KEY } from '../src/config.js';
const onecli = new OneCLI({ url: ONECLI_URL, apiKey: ONECLI_API_KEY });
const args: string[] = ['run', '--rm'];
await onecli.ensureAgent({ name: 'aq-probe', identifier: 'default' });
const applied = await onecli.applyContainerConfig(args, { addHostMapping: false, agent: 'default' });
// find injected ANTHROPIC_API_KEY value
let injected: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-e' && /^ANTHROPIC_API_KEY=/.test(args[i + 1] || '')) {
    injected = (args[i + 1] as string).slice('ANTHROPIC_API_KEY='.length);
  }
}
const real = readEnvFile(['ANTHROPIC_API_KEY']).ANTHROPIC_API_KEY || '';
console.log('applied:', applied);
console.log('injects_ANTHROPIC_API_KEY:', injected !== null);
if (injected !== null) {
  console.log('injected_len:', injected.length, 'real_len:', real.length);
  console.log('injected_equals_real_key:', injected === real);
  console.log('injected_prefix_class:', /^sk-ant-api/.test(injected) ? 'real-style' : 'dummy-style');
}
console.log('other_injected_flags:', args.filter((a, i) => a === '-e').map((_, i) => args[args.indexOf('-e') ]).length, 'proxy?', args.join(' ').includes('PROXY'));
