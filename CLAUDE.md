# Sinapse APP — instruções para o Claude Code

## Objetivo
Aplicação web de gestão operacional e financeira da clínica Sinapse (agenda, salas, profissionais,
pacientes, pagamentos, packs, controlo de faturação externa, avisos mensais manuais). Não é um
sistema clínico: não guardar prontuários, diagnósticos, notas terapêuticas nem registos de saúde.
Interface em português de Portugal, datas DD/MM/YYYY, 24 h, EUR, fuso Europe/Lisbon (na base de
dados e na API guardar tempos em UTC com timestamptz).

## Arquitetura (sem Docker, tudo instalado nas máquinas)
- Frontend: React + TypeScript + Vite. Backend: Node.js 26 + TypeScript, API REST com OpenAPI.
- Base de dados: PostgreSQL (versão do Ubuntu 24.04) com Prisma e migrações versionadas.
- Nginx como reverse proxy e HTTPS (Let's Encrypt). Serviços via systemd.
- Sessões por cookie HttpOnly/Secure/SameSite (não usar Authorization Bearer: o Basic Auth do
  Nginx em DEV entra em conflito com esse cabeçalho).
- Portas: API em desenvolvimento 3001; serviço systemd "como produção" 3000 (Nginx aponta para 3000).

## Máquinas
- DEV (OCI, conta do programador, aarch64): onde se desenvolve, com o utilizador `dev` (sem sudo).
  Repositório em /home/dev/github/sinapse. Nginx + HTTPS + Basic Auth em abpt-dev.duckdns.org.
  Só dados fictícios.
- PRODUÇÃO (OCI, conta da clínica, aarch64, uma só VM): ainda não criada. Domínio por definir.
- O código viaja por Git. Publicação manual e controlada, só de tags aprovadas. Sem CI/CD.

## Regras de segurança
- Nunca colocar segredos no Git, no CLAUDE.md, em logs ou em conversas. `.env` real fora do Git.
- Nunca usar dados reais de pacientes em DEV. Utilizadores de seed com passwords aleatórias.
- Autorização sempre no backend. Validar entradas no frontend e no backend.
- O utilizador PostgreSQL da aplicação nunca é superuser.
- Testes destrutivos só contra `sinapse_test` (descartável). Recusar correr se o nome da base ou o
  host forem inesperados.
- Operações destrutivas (apagar dados, git reset --hard, git clean, rm -rf) só com aprovação explícita.

## Regras financeiras e de packs
- Preços e valores ficam preservados no momento em que ocorrem (sessão, pack, pagamento).
- Pagamentos, alocações, consumo de packs, correções e registo de faturação são transacionais,
  auditáveis e protegidos contra concorrência. Sem apagar movimentos: usar correção/reembolso.
- Uma sessão de pack só consome quando está realizada; cancelar/faltar não consome por defeito.
- Packs e sessões individuais só são elegíveis para faturação quando totalmente pagos; um pack
  fatura-se no máximo uma vez; sessões cobertas por pack faturado não se faturam à parte.
- Não contar a venda do pack e o consumo das suas sessões como receitas distintas.
- Regras fiscais: a validar com o responsável da clínica ou contabilista; não inventar requisitos.

## Git
- `main` é estável e publicável. Trabalho em branches `feat/...`, `fix/...`, `chore/...`.
- Commits pequenos e descritivos. Publicar só tags aprovadas, depois de testes e build.

## Critérios de conclusão de uma tarefa
Compila, testes relevantes passam, migrações validadas, sem segredos, documentação atualizada e
evidência verificável. Não declarar nada concluído sem prova.

## Perfis de utilizador
Administrador; Administrativo (receção e financeiro juntos, decisão da clínica: a mesma equipa
faz ambas as funções); Profissional (médicos e terapeutas, só consulta da própria agenda, Etapa C).
Permissões definidas no backend (ex.: `payments:create`). Auditoria obrigatória em ações financeiras.

## Decisões técnicas da Etapa A
- API: Fastify + TypeScript, validação com schemas, OpenAPI em /api/v1.
- Base de dados: Prisma + PostgreSQL. Sessões na base de dados, cookie HttpOnly/Secure/SameSite=Lax,
  verificação de Origin em pedidos que alteram dados. Login por email, passwords com argon2id.
- Sessão: 60 min de inatividade, máximo 12 h. Sem 2FA na POC (evolução futura).
- Frontend: React + Vite + React Router + TanStack Query + react-hook-form/zod + Tailwind CSS.
- Testes: Vitest; integração contra `sinapse_test`. Playwright só na Fase 4.
- Primeiro administrador criado por comando interativo no servidor; sem credenciais por defeito.

## Comandos (raiz do repositório)
- `npm install`: instala dependências (Node 26, `engine-strict`, versões exatas).
- `npm run lint`, `npm run format`, `npm run format:check`, `npm run typecheck`.
- `npm run build -w backend`.
- `npm run dev -w backend`: API em modo desenvolvimento (porta 3001, lê `backend/.env`).
- `npm test`: testes (Vitest). `npm run build -w backend` e `npm run start -w backend` para o compilado.
- Documentação OpenAPI em `/api/v1/docs` (só fora de produção). Health em `/api/v1/health`.
- Logs: nunca registar cabeçalhos, cookies nem query strings; mensagens de erro ao cliente sem detalhes internos.
- Base de dados (Prisma 7, adaptador pg): `npm run db:generate -w backend` (obrigatório antes de typecheck/build), `db:migrate` (dev), `db:deploy` (aplica migrações existentes), `db:status`. Cliente gerado em `backend/src/generated/` (fora do Git).
- Migrações com restrições que o Prisma não modela: criar com `--create-only`, editar o SQL e só depois aplicar.
- Tabelas: `users`, `sessions` (guarda hash do token), `audit_log` (só de acréscimo, com trigger). Utilizadores não se apagam, desativam-se.
- Testes de integração: só contra `sinapse_test` em localhost (recusam outra base). Variáveis em `backend/.env`: `DATABASE_URL`, `TEST_DATABASE_URL`.
- Erros da base de dados: registar só o nome/código, nunca parâmetros nem mensagens completas (podem conter dados pessoais).
