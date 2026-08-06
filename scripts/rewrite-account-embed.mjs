import { readFile, writeFile } from 'node:fs/promises';

const shellPath = new URL('../shared/account-shell.js', import.meta.url);
const cssPath = new URL('../shared/account-shell.css', import.meta.url);

const oldAttach = `  function attachTrigger() {
    if (triggerHost?.isConnected) return;
    triggerHost = document.createElement('div');
    triggerHost.id = \`hao-account-\${config.productCode || 'app'}\`;
    triggerHost.className = 'hao-account-mount';
    const target = findMount();
    if (target) {
      triggerHost.classList.add('is-embedded');
      if (config.mountPosition === 'prepend') target.prepend(triggerHost);
      else target.appendChild(triggerHost);
    } else {
      triggerHost.classList.add('is-floating');
      document.body.appendChild(triggerHost);
      if (Array.isArray(config.mountSelectors) || config.mountSelector) {
        mountObserver = new MutationObserver(() => {
          const laterTarget = findMount();
          if (!laterTarget || !triggerHost?.isConnected) return;
          triggerHost.classList.remove('is-floating');
          triggerHost.classList.add('is-embedded');
          laterTarget.appendChild(triggerHost);
          mountObserver?.disconnect();
        });
        mountObserver.observe(document.documentElement, { childList: true, subtree: true });
        window.setTimeout(() => mountObserver?.disconnect(), 10000);
      }
    }
    renderTrigger();
  }
`;

const newAttach = `  function attachTrigger() {
    if (!triggerHost) {
      triggerHost = document.createElement('div');
      triggerHost.id = \`hao-account-\${config.productCode || 'app'}\`;
      triggerHost.className = 'hao-account-mount is-embedded';
    }

    const target = findMount();
    if (!target) {
      triggerHost.remove();
      return false;
    }

    if (triggerHost.parentElement !== target) {
      if (config.mountPosition === 'prepend') target.prepend(triggerHost);
      else target.appendChild(triggerHost);
      renderTrigger();
    } else if (!triggerHost.firstChild) {
      renderTrigger();
    }
    return true;
  }

  function observeMount() {
    mountObserver?.disconnect();
    mountObserver = new MutationObserver(() => {
      const target = findMount();
      if (!target || triggerHost?.parentElement !== target) attachTrigger();
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
`;

let shell = await readFile(shellPath, 'utf8');
if (!shell.includes(oldAttach)) throw new Error('Expected legacy floating attachTrigger implementation was not found.');
shell = shell.replace(oldAttach, newAttach);
shell = shell.replace('    attachTrigger();\n    document.addEventListener', '    attachTrigger();\n    observeMount();\n    document.addEventListener');
await writeFile(shellPath, shell, 'utf8');

const floatingCss = `.hao-account-mount.is-floating {
  position: fixed;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  z-index: 9996;
}

`;
let css = await readFile(cssPath, 'utf8');
if (!css.includes(floatingCss)) throw new Error('Expected floating account CSS was not found.');
css = css.replace(floatingCss, '');
await writeFile(cssPath, css, 'utf8');

// One-shot branch rewrite; removed before merge.
