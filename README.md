# Gestão de Férias — migração para Supabase

Cópia independente preparada para GitHub Pages. O site atual não é alterado por este projeto.

## Estado em 31/08/2026

- Migration `supabase/migrations/202608310001_initial.sql` aplicada com sucesso pelo SQL Editor no projeto de testes `ejakaaehwbzjlclkcrcp`.
- Seis tabelas: `managers`, `sectors`, `collaborators`, `vacation_periods`, `app_metadata` e `audit_log`.
- RLS habilitado nas seis tabelas. Sem acesso direto às tabelas por `anon` ou `authenticated`.
- Somente usuários autenticados podem executar `get_shared_state` e `apply_mutation`. As funções validam a identidade no servidor.
- Alterações serializadas por revisão: uma edição baseada em dados antigos é recusada, sem sobrescrever a edição de outro usuário.
- Histórico registra autor, ação e identificador. Não é um backup completo nem histórico de todos os valores anteriores.
- Nenhum colaborador real foi carregado no novo banco. A migração de dados permanece pendente.
- A aplicação estática usa autenticação Supabase e já teve login e gravação de um cadastro validados no ambiente local. A publicação no GitHub ainda está pendente.

## Migration já executada

Não execute novamente a migration inicial neste banco: ela cria objetos já existentes. Mudanças futuras precisam de um novo arquivo SQL. A aplicação foi manual pelo SQL Editor; o histórico da CLI Supabase não foi registrado. Antes de usar `supabase db push`, reconcilie o histórico com o banco existente.

`supabase/verify.sql` contém consultas somente de leitura para conferir as permissões e o estado inicial.

## Desenvolvimento

Requer Node.js 24 e pnpm 11.

```sh
pnpm install
pnpm test
pnpm build
```

Em um ambiente que restringe criação de subprocessos, os testes podem ser executados com `node --test --test-isolation=none tests/*.test.mjs`. O teste do banco usa PostgreSQL local em memória via PGlite, não altera o Supabase nem os dados reais.

Configure `site/config.js` com a chave **publishable** pública do projeto. Nunca inclua senha do banco, chave secreta ou `service_role`.

## Antes de publicar

1. Configurar as URLs permitidas no Supabase Auth para o endereço local e a URL definitiva do GitHub Pages.
3. Configurar envio de e-mails para os usuários: o SMTP padrão do Supabase é limitado e não é adequado ao uso geral em produção. Não desligar confirmação de e-mail como atalho.
4. Transferir o backup por um procedimento administrativo, depois de validar a base e confirmar qual cópia é a mais recente. Nunca colocar o backup no repositório ou na pasta publicada.
5. Publicar somente o artefato `dist/` no GitHub Pages pelo workflow `.github/workflows/pages.yml`. Revisar o repositório antes de torná-lo público; esta pasta não deve herdar o histórico do site anterior.
6. Testar o endereço `github.io` e o endpoint `supabase.co` na rede da empresa. Acesso a `github.com` não garante acesso a esses outros domínios.

No modelo atual, todas as contas autenticadas podem visualizar e editar toda a base. Perfis e aprovação de acesso ainda não foram implementados. A atualização entre sessões ocorre por consulta a cada 30 segundos e ao voltar à janela; não usa Supabase Realtime.
