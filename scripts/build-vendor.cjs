const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
  const target = path.resolve(__dirname, '../public/vendor'); fs.mkdirSync(target, { recursive: true });
  const passkeyDir=path.resolve(__dirname,'../node_modules/@simplewebauthn/browser');
  fs.copyFileSync(path.join(passkeyDir,'dist/bundle/index.umd.min.js'),path.join(target,'simplewebauthn.js'));
  fs.copyFileSync(path.join(passkeyDir,'LICENSE.md'),path.join(target,'simplewebauthn-LICENSE.md'));
  fs.copyFileSync(require.resolve('hls.js/dist/hls.min.js'), path.join(target, 'hls.min.js'));
  const source = path.dirname(require.resolve('jassub'));
  fs.cpSync(source, path.join(target, 'jassub'), { recursive: true, filter: file => !file.endsWith('.map') && !file.endsWith('.d.ts') });
  for (const name of ['jassub.js', 'worker/worker.js']) await esbuild.build({ entryPoints: [path.join(source, name)], outfile: path.join(target, 'jassub', name), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
  for (const pkg of ['jassub', 'hls.js', 'abslink', 'rvfc-polyfill', 'lfa-ponyfill', 'throughput']) {
    const dir = path.resolve(__dirname, '../node_modules', pkg);
    for (const name of fs.readdirSync(dir).filter(name => /licen[cs]e|copying/i.test(name))) if (fs.statSync(path.join(dir, name)).isFile()) fs.copyFileSync(path.join(dir, name), path.join(target, `${pkg.replace('/', '-')}-${name}`));
  }
  fs.writeFileSync(path.join(target, 'THIRD-PARTY.md'), '# Local player dependencies\n\nhls.js 1.7.4: https://github.com/video-dev/hls.js\nJASSUB 2.5.35: https://github.com/ThaUnknown/jassub (including libass and its font/rendering dependencies).\n\nKeep the accompanying license notices. Source and build instructions are available in the linked upstream repositories. Rebuild these separate, replaceable assets with npm run build:vendor.\n');
  console.log('Built local HLS and ASS renderer assets');
})().catch(error => { console.error(error); process.exitCode = 1; });
