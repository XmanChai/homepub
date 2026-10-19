import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmpDir(prefix = 'homepub-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function baseConfig(overrides = {}) {
  const config = {
    domain: 'example.com',
    server: { addr: '203.0.113.10', port: 7000, tokenEnv: 'FRP_TOKEN' },
    tunnel: { portStart: 18081, portEnd: 18085 },
    services: [
      { name: 'blog', subdomain: 'blog', localPort: 8090 },
      { name: 'cloud', subdomain: 'nc', localPort: 8080, healthPath: '/status.php' }
    ]
  };
  return { ...config, ...overrides };
}
