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

## Comandos
Por definir quando o projeto for criado (instalação, desenvolvimento, testes, migrações, build).
