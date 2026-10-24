# Captura Total

Sistema web (SaaS por assinatura) para **captura automática de notas fiscais eletrônicas** (NF-e, NFC-e e NFS-e) a partir dos web services oficiais, usando o **certificado digital A1** da empresa. Faz, de forma simplificada, o que sistemas como o vFisco fazem: baixa os XMLs direto da SEFAZ (e do padrão nacional / prefeituras, no caso da NFS-e) e organiza tudo num painel.

Construído com **Node.js + Express + EJS + MongoDB**.

> ⚠️ **Uso legítimo.** Capture apenas notas das empresas das quais você tem o certificado digital e autorização. O certificado A1 é o que prova, perante a Receita, que você é aquele CNPJ.

---

## Como funciona a captura

| Documento | Mecanismo | Precisa de |
|-----------|-----------|------------|
| **NF-e / NFC-e** (modelo 55/65) | Web service nacional **NFeDistribuicaoDFe** (SVRS). Busca incremental por NSU: baixa todos os documentos de interesse do CNPJ (notas de entrada onde a empresa é destinatária, eventos e resumos). | Certificado A1 (mTLS) |
| **NFS-e** (serviços) | Adaptadores plugáveis: **padrão nacional (ADN)** onde o município aderiu, e **robôs/APIs por provedor** (GINFES, ISSNet, etc.) nos demais. | Certificado A1 e/ou login do portal |

O certificado e as senhas são **criptografados com AES-256-GCM** antes de irem para o banco. Nada é salvo em texto puro.

---

## Requisitos

- Node.js 20 ou superior
- MongoDB (local ou Atlas)

## Instalação

```bash
npm install
cp .env.example .env
```

Edite o `.env`. Gere a chave de criptografia dos certificados:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole o resultado em `CERT_ENCRYPTION_KEY`.

Defina o primeiro usuário (administrador) no `.env`:

```env
ADMIN_NOME=Administrador
ADMIN_EMAIL=voce@suaempresa.com.br
ADMIN_SENHA=uma-senha-forte
```

Ao iniciar, se o banco ainda não tiver nenhum usuário, ele é criado automaticamente com esses dados (se já houver usuários, nada é alterado):

```bash
npm start        # http://localhost:3000
```

Para criar o usuário sem subir o servidor: `npm run seed`.

Em desenvolvimento: `npm run dev` (reinicia ao salvar).

## Fluxo de uso

1. Confira `SEFAZ_AMBIENTE=producao` no `.env` (em homologação não existem notas reais).
2. **Certificados →** enviar o `.pfx`/`.p12` e a senha.
3. **Captura →** cadastrar a empresa do certificado (CNPJ e UF já vêm preenchidos) e clicar em **Capturar agora**.
   O agendador repete a captura sozinho (`SCHEDULER_CRON`, padrão: a cada hora).
4. **Notas fiscais →** filtrar, buscar e baixar o XML. Notas marcadas como **resumo** têm o botão
   **Baixar XML completo**, que envia a Ciência da Operação e baixa o XML (ou ligue `SEFAZ_CIENCIA_AUTOMATICA=true`).

### Pessoa física (CPF)

Cadastre o contribuinte com o **CPF** e vincule o **e-CPF A1** da própria pessoa. O sistema captura:
- **NF-e (produtos)** em que o CPF é destinatário, pela Distribuição DF-e da SEFAZ;
- **NFS-e (serviços)** em que o CPF é tomador (ou prestador), pelo Ambiente de Dados Nacional (ADN) da NFS-e.
  Só aparecem NFS-e emitidas pelo padrão nacional; o XML já vem completo.

### Regras da SEFAZ que afetam a captura

- A Distribuição DF-e entrega as notas em que a empresa é **destinatária** (entradas) e eventos; notas **emitidas pela própria empresa** não vêm por esse serviço.
- Só ficam disponíveis documentos dos **últimos 90 dias**.
- Quando a SEFAZ responde "137 - nenhum documento localizado", só se pode consultar de novo após **1 hora**; consultar antes gera bloqueio "656 - consumo indevido". O sistema respeita esse intervalo automaticamente.

---

## Recursos

- **Captura automatica** de NF-e/NFC-e (SEFAZ), NFS-e (Ambiente Nacional) e CT-e, por CNPJ ou CPF.
- **Importar XML** (soltos ou em ZIP) para notas de venda emitidas por voce e historico com mais de 90 dias.
- **Manifestacao do destinatario**: ciencia (libera o XML completo), confirmacao, desconhecimento e operacao nao realizada, com alerta de prazo (180 dias).
- **PDF**: DANFE (NF-e, leiaute retrato), DANFSe (layout oficial NT 008) e DACTE; download em lote (ZIP).
- **Filtros** por mes, ano, periodo, tipo, tomadas/prestadas e situacao; **relatorios** mensais, por fornecedor/cliente, CFOP e NCM, com **Excel**.
- **Usuarios** com perfis (administrador/operador), cadastro publico fechado, protecao CSRF e limite de tentativas de login.
- **Backup diario** do banco, **pagina de saude do sistema** e **alertas por e-mail** (opcional).

## Emissao de NFS-e (Emissor Nacional)

Menu **Emitir NFS-e**. Gratuito: usa a API oficial da Sefin Nacional com o certificado A1 do prestador.

1. Em **Emitir NFS-e -> configurar**, informe o codigo IBGE do municipio, o regime (nao optante, MEI ou ME/EPP) e a serie.
   Use **Verificar agora** para confirmar se o municipio libera o Emissor Nacional.
2. Comece em **producao restrita** (teste, sem valor fiscal). Emita notas de teste e confira o PDF.
3. Quando estiver tudo certo, mude o ambiente para **producao**.

O numero da DPS so avanca quando a Sefin autoriza; reenviar apos uma falha de conexao e seguro (a nota ja gerada e recuperada).
O enquadramento fiscal (codigo do servico, retencao, aliquota) e responsabilidade do emitente: confirme com o contador.

## Comandos uteis

```bash
npm run dev               # desenvolvimento (reinicia ao salvar)
npm start                 # producao
npm test                  # testes automaticos
npm run backup            # backup manual do banco
npm run restaurar         # lista backups; restaurar: npm run restaurar -- <nome> --confirmar
npm run servico:instalar  # instala como servico do Windows (PowerShell como administrador;
                          # antes: npm install node-windows@1.0.0-beta.8 --no-save)
npm run servico:remover
```

## Estrutura

```
src/
  config/        env, conexão MongoDB
  models/        User, Empresa, Certificado, NotaFiscal, CapturaLog
  routes/        auth, dashboard, empresas, certificados, notas
  middleware/    autenticação de sessão
  services/
    crypto/      cofre AES-256-GCM + leitura do .pfx (node-forge)
    sefaz/       cliente SOAP mTLS + NFeDistribuicaoDFe + parser de documentos
    nfse/        adaptadores (nacional, exemplo municipal) + registro
    scheduler/   captura automática (node-cron)
    capturaService.js   orquestra NF-e + NFS-e por empresa
  views/         EJS (painel, notas, empresas, certificados)
  public/css/    estilo
```

---

## O que já está pronto e o que precisa de ajuste

**Pronto e funcional**
- Autenticação, empresas, upload/validação e criptografia do certificado.
- Cliente SOAP com mTLS e o fluxo completo da `NFeDistribuicaoDFe` (envelope, busca incremental por NSU, descompactação gzip/base64, parsing e gravação dos XMLs, controle de duplicatas).
- Dashboard, listagem com filtros, download de XML, agendador e logs de execução.
- Arquitetura extensível de NFS-e com um adaptador de exemplo.

**Precisa da sua ação / ambiente real**
- **Testar em homologação** (`SEFAZ_AMBIENTE=homologacao`) com um certificado A1 real antes de ir para produção. A SEFAZ valida a cadeia ICP-Brasil no TLS.
- **Manifestação do destinatário**: o endpoint já está mapeado; a assinatura XML do evento (xml-crypto) deve ser finalizada conforme seu caso de uso para liberar o XML completo de notas que vêm só como resumo.
- **NFS-e nacional**: preencher os endpoints oficiais do ADN no adaptador `nacional`.
- **NFS-e municipal**: criar um adaptador por provedor/cidade conforme a necessidade (o `exemplo` mostra o formato).

---

## Modo SaaS (venda por assinatura)

O sistema funciona como **SaaS**: qualquer pessoa cria a propria conta em `/registrar`, usa **14 dias gratis** e depois assina um plano. Cada conta enxerga apenas as proprias empresas, certificados e notas.

| O que | Onde |
|---|---|
| Site com planos (visitante) | `/` |
| Cadastro com teste gratis | `/registrar` |
| Esqueci a senha (link por e-mail) | `/esqueci-senha` |
| Plano, fatura, dados da conta, alertas, ciencia automatica | `/assinatura` (menu **Minha conta**) |
| Painel do dono da plataforma: todas as contas, receita, liberar/suspender | `/plataforma` (so para `ADMIN_EMAIL` / `PLATAFORMA_ADMINS`) |
| Notificacoes de pagamento do Asaas | `POST /webhooks/asaas` |
| Verificacao de saude (Render/Railway) | `/healthz` |

**Planos** (por quantidade de CNPJs/CPFs; usuarios ilimitados): Basico 3 por R$ 79,90, Profissional 15 por R$ 199,90, Escritorio 50 por R$ 449,90. Troque precos e limites em `src/config/planos.js` ou pelas variaveis `PLANO_<ID>_PRECO` / `PLANO_<ID>_EMPRESAS`.

**Situacoes da conta:** `teste` → `pendente` (escolheu plano, aguardando 1o pagamento) → `ativa`. Atraso vira `inadimplente` e bloqueia depois de `CARENCIA_DIAS`. `cancelada` usa ate o fim do periodo pago. `suspensa` e bloqueio manual. `cortesia` e liberada sem cobranca: as contas que ja existiam antes do SaaS viram cortesia automaticamente, entao nada para de funcionar.

Conta bloqueada so consegue abrir **Minha conta** (para pagar); a captura automatica dela tambem para. Os dados nao sao apagados.

### Cobranca pelo Asaas

1. Crie a conta no Asaas (comece pelo **sandbox**: https://sandbox.asaas.com).
2. **Integracoes → Chave de API** → copie para `ASAAS_API_KEY`.
3. Invente um token longo (32+ caracteres) e coloque em `ASAAS_WEBHOOK_TOKEN`.
4. **Integracoes → Webhooks → novo**: URL `https://SEU-DOMINIO/webhooks/asaas`, mesmo token, eventos de **Cobrancas** e **Assinaturas**, fila ligada.
5. Teste uma assinatura no sandbox (o Asaas tem botao para simular pagamento). Quando funcionar, troque a chave e `ASAAS_AMBIENTE=producao` e refaca o webhook na conta de producao.

A assinatura e criada com forma de pagamento "a escolha do cliente" (Pix, boleto ou cartao). Durante o teste gratis, a 1a cobranca vence no ultimo dia do teste.

### Publicar no Render

1. Suba o projeto para um repositorio no GitHub (o `.env` fica de fora).
2. Crie um banco gratuito no **MongoDB Atlas** e copie a string `mongodb+srv://...`. Em *Network Access*, libere `0.0.0.0/0` (o Render nao tem IP fixo no plano basico).
3. No Render: **New → Blueprint** → escolha o repositorio. O `render.yaml` da raiz do repositorio cria a API e o site React.
4. Preencha as variaveis pedidas: `MONGODB_URI`, `APP_URL`, `CERT_ENCRYPTION_KEY`, `ADMIN_EMAIL`, `ADMIN_SENHA`, Asaas e SMTP.
   - **Migrando do seu computador?** Use a MESMA `CERT_ENCRYPTION_KEY` do seu `.env` atual, senao os certificados ja cadastrados nao abrem. Guarde essa chave num lugar seguro.
5. Use o plano **Starter** (pago): o gratuito "dorme" sem acesso e a captura automatica para.
6. Mantenha **1 instancia**: o agendador e as travas de captura ficam na memoria do servidor.
7. Aponte seu dominio em *Settings → Custom Domains* e atualize `APP_URL`.

### Publicar no Railway

1. **New Project → Deploy from GitHub repo**. O `railway.json` usa o `Dockerfile`.
2. Em *Variables*, cole as mesmas variaveis do `.env.example` (com `NODE_ENV=production`).
3. Gere o dominio em *Settings → Networking* e coloque em `APP_URL`.

### Levar os dados do seu computador para a nuvem

Rode `mongodump` no seu MongoDB local e `mongorestore` na URI do Atlas (MongoDB Database Tools), ou use o **Compass**: exportar colecoes e importar no Atlas. Mantenha a mesma `CERT_ENCRYPTION_KEY`.

### Antes de vender

- Revise os textos de `/termos` e `/privacidade` (sao modelos) com um advogado e informe a empresa responsavel e o encarregado de dados (LGPD).
- Configure o SMTP: sem ele nao ha e-mail de boas-vindas, recuperacao de senha nem alertas.
- Ligue o backup automatico do MongoDB Atlas (o backup em pasta local nao serve na nuvem).

---

## API JSON (`/api/v1`) para o site React e o app

Login por token: `POST /api/v1/auth/login` devolve `accessToken` (15 min) e `refreshToken` (30 dias, trocado a cada uso). Envie `Authorization: Bearer <accessToken>`; quando expirar, chame `POST /auth/renovar`. Erros vem como `{ "erro": "mensagem", "codigo": "..." }`; `402` = assinatura bloqueada.

| Grupo | Rotas |
|---|---|
| Publico | `GET /planos` · `POST /auth/login` · `/auth/registrar` · `/auth/renovar` · `/auth/sair` · `/auth/esqueci-senha` · `/auth/redefinir-senha` |
| Usuario | `GET /me` · `POST /me/senha` · `POST /dispositivos` (push) |
| Painel | `GET /painel` |
| Notas | `GET /notas` (mesmos filtros do painel + `pagina`) · `GET /notas/exportar?formato=xml\|pdf\|ambos` · `GET /notas/:id` · `/notas/:id/xml` · `/notas/:id/pdf` · `POST /notas/:id/ciencia` · `POST /notas/:id/manifestar` |
| Empresas | `GET/POST /empresas` · `GET/PUT/DELETE /empresas/:id` · `POST /empresas/:id/capturar` · `POST /captura/todas` · `GET /captura/historico` |
| Certificados | `GET /certificados` · `POST /certificados` (multipart: `pfx`, `senha`, `apelido`) · `DELETE /certificados/:id` |
| Relatorios | `GET /relatorios` · `GET /relatorios/excel` |
| Usuarios | `GET/POST /usuarios` · `PATCH/DELETE /usuarios/:id` |
| Conta | `GET/PUT /conta` · `POST /conta/plano` · `GET /conta/fatura` · `POST /conta/cancelar` |
| Plataforma | `GET /plataforma/contas` · `POST /plataforma/contas/:id` |

Variaveis novas: `WEB_URL` (endereco do site React, libera CORS), `CORS_ORIGINS`, `JWT_SECRET` (opcional) e `FIREBASE_SERVICE_ACCOUNT` (push).

---

## Aviso legal

Ferramenta para uso fiscal legítimo pelas próprias empresas. O uso do certificado
digital e o acesso aos web services da Receita seguem as regras da SEFAZ e da
ICP-Brasil. Respeite os termos de uso dos portais municipais ao configurar robôs.
