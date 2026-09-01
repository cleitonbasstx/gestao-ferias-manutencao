import { createClient } from '@supabase/supabase-js';

const gate = document.querySelector('#auth-gate');
const message = document.querySelector('#auth-message');
const form = document.querySelector('#auth-form');
const recoveryForm = document.querySelector('#recovery-form');
let client;
let currentUser;
let started = false;
let recovery = new URLSearchParams(location.search).has('recover');
let resolveLogin;
const SIGNUP_DOMAIN = '@suzano.com.br';
const loggedIn = new Promise(resolve => { resolveLogin = resolve; });

function isSuzanoEmail(email) {
  return email.toLowerCase().endsWith(SIGNUP_DOMAIN) && email.slice(0, -SIGNUP_DOMAIN.length).length > 0;
}

function showError(error) {
  gate.hidden = false;
  document.documentElement.classList.remove('authenticated');
  message.textContent = error?.message || 'Não foi possível conectar. Confira a rede e tente novamente.';
  message.setAttribute('role', 'alert');
}
function authMessage(text) {
  message.textContent = text;
  message.setAttribute('role', 'status');
}
function acceptSession(session) {
  currentUser = session?.user;
  if (!currentUser || recovery) return;
  form.elements.password.value = '';
  authMessage('Carregando os dados compartilhados…');
  resolveLogin();
}
function redirectUrl(recover = false) {
  return `${location.origin}${location.pathname}${recover ? '?recover=1' : ''}`;
}
async function ready() {
  if (!started) {
    started = true;
    const config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.publishableKey) {
      throw new Error('Conexão em preparação: configure a URL e a chave pública do Supabase.');
    }
    client = createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: (input, init = {}) => fetch(input, {
        ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
      }) }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        document.documentElement.classList.remove('authenticated');
        location.replace(redirectUrl());
      }
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      if (recovery && session) {
        form.hidden = true;
        recoveryForm.hidden = false;
        authMessage('Defina sua nova senha.');
      } else if (session) acceptSession(session);
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) acceptSession(data.session);
    else authMessage(recovery ? 'Abra novamente o link de recuperação enviado ao seu e-mail.' : 'Entre para acessar os dados compartilhados.');
  }
  return loggedIn;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!client) return;
  const action = event.submitter?.value || 'login';
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !form.elements.email.checkValidity()) return form.elements.email.reportValidity();
  if (action !== 'reset' && password.length < 8) return authMessage('Utilize uma senha de pelo menos 8 caracteres.');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  authMessage('Aguarde…');
  try {
    if (action === 'reset') {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl(true) });
      if (error) throw error;
      authMessage('Se houver uma conta para esse e-mail, você receberá as instruções de recuperação.');
    } else if (action === 'signup') {
      if (!isSuzanoEmail(email)) {
        authMessage('Novos cadastros são permitidos somente com e-mail @suzano.com.br.');
        return;
      }
      const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      form.elements.password.value = '';
      authMessage('Confira seu e-mail para confirmar o cadastro antes de entrar.');
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      acceptSession(data.session);
    }
  } catch (error) {
    authMessage(error.code === 'invalid_credentials' ? 'E-mail ou senha inválidos.' : `Não foi possível concluir: ${error.message}`);
  } finally { buttons.forEach(button => { button.disabled = false; }); }
});
recoveryForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = recoveryForm.elements.newPassword.value;
  const button = recoveryForm.querySelector('button');
  button.disabled = true;
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    recoveryForm.reset();
    recovery = false;
    history.replaceState(null, '', location.pathname);
    const { data } = await client.auth.getSession();
    acceptSession(data.session);
  } catch (error) { authMessage(error.message); }
  finally { button.disabled = false; }
});

async function requestState(mutation) {
  const { data, error } = mutation
    ? await client.rpc('apply_mutation', { mutation })
    : await client.rpc('get_shared_state');
  if (error) return new Response(JSON.stringify({ message: error.message }), {
    status: error.code === '40001' ? 409 : error.code === '42501' ? 403 : 400
  });
  return new Response(JSON.stringify({ ...data, session: { email: currentUser?.email } }), { status: 200 });
}
window.VacationBackend = {
  ready, requestState, showError,
  reveal() { gate.hidden = true; document.documentElement.classList.add('authenticated'); },
  async logout() {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) showError(error);
  }
};
