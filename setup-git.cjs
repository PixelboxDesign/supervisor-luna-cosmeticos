const { execSync } = require('child_process');
const path = require('path');

const DIR = 'F:\\luna_cosmeticos\\supervisor-luna';
process.chdir(DIR);

const run = (cmd, opts = {}) => {
  try {
    const o = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', cwd: DIR, ...opts });
    if (o && o.trim()) console.log(o.trim());
    return true;
  } catch(e) {
    const m = (e.stdout||'')+(e.stderr||'')+e.message;
    if (m.includes('already exists') || m.includes('already initialized')) { console.log('[ok]'); return true; }
    console.error('ERR:', m.substring(0, 300));
    return false;
  }
};

console.log('📁', process.cwd());

// Inicializar git
run('git init');
run('git branch -M main');

// Copiar config de identidade do repositório do Luna
try {
  const email = execSync('git config user.email', { encoding:'utf-8', cwd:'F:\\luna_cosmeticos\\trafego_luna_cosmeticos' }).trim();
  const name  = execSync('git config user.name',  { encoding:'utf-8', cwd:'F:\\luna_cosmeticos\\trafego_luna_cosmeticos' }).trim();
  run(`git config user.email "${email}"`);
  run(`git config user.name "${name}"`);
  console.log(`Identidade: ${name} <${email}>`);
} catch(e) {
  // fallback
  run('git config user.email "pandboxdesign@gmail.com"');
  run('git config user.name "Matheus Maia"');
}

// Configurar remote — usar o mesmo owner do projeto Luna
// Primeiro ver o remote do projeto Luna para pegar o owner
try {
  const remoteUrl = execSync('git remote get-url origin', {
    encoding: 'utf-8', cwd: 'F:\\luna_cosmeticos\\trafego_luna_cosmeticos'
  }).trim();
  console.log('Remote Luna:', remoteUrl);
  // Extrair owner: https://github.com/OWNER/repo.git
  const match = remoteUrl.match(/github\.com[/:](.+?)\/(.+?)(?:\.git)?$/);
  if (match) {
    const owner    = match[1];
    const newRepo  = `${owner}/supervisor-luna-cosmeticos`;
    const newRemote = `https://github.com/${newRepo}.git`;
    console.log(`\nRepositório a criar: ${newRepo}`);
    console.log(`Remote: ${newRemote}`);
    run(`git remote add origin ${newRemote}`);
  }
} catch(e) {
  console.log('Não conseguiu detectar owner:', e.message);
}

run('git add .');
run('git status --short');
run('git commit -m "feat: sistema de supervisão de logs - backend local + frontend Render + Electron tray"');

console.log('\n⚠️  Crie o repositório "supervisor-luna-cosmeticos" no GitHub e depois execute:');
console.log('   git push -u origin main');
console.log('\nOu mude o remote para o seu repositório correto.');
