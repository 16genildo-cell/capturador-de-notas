# danfse-nacional

Gera o **DANFSe v2.0** (PDF) da **NFS-e Nacional** a partir do XML, em Node.js, conforme a
[Nota Técnica SE/CGNFS-e nº 008/2026, versão 1.02](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf).

A API oficial que gerava o DANFSe (`adn.nfse.gov.br/danfse`) foi **suspensa em agosto de 2026**. Desde então,
cada sistema emissor, ERP ou escritório precisa gerar o documento por conta própria. Esta biblioteca faz só isso:

- **XML entra, PDF sai.** Sem certificado digital, sem chamada de rede, sem navegador.
- **Aceita XML sem assinatura**, como o montado a partir da tela do portal ou por sistemas de integração.
- **Layout da NT 008:** A4 retrato, uma página, grade do Anexo I, QR Code de consulta pública, blocos resumidos
  quando não há tomador, destinatário ou intermediário, e marca d'água de **CANCELADA** ou **SUBSTITUÍDA**.
- **Reforma Tributária:** bloco IBS/CBS completo, com as regras de soma da NT (exclusões da base, PIS/COFINS retidos etc.).
- **Poucas dependências:** `pdfkit`, `qrcode` e `@xmldom/xmldom`.

## Instalação

```bash
npm install github:ebnack/danfse-nacional-node
```

Node.js 18 ou mais novo.

## Uso

```js
const fs = require('node:fs');
const { gerarDanfse } = require('danfse-nacional');

const xml = fs.readFileSync('nota.xml');
const pdf = await gerarDanfse(xml);          // Buffer com o PDF
fs.writeFileSync('nota.pdf', pdf);
```

### Opções

```js
await gerarDanfse(xml, {
  situacao: 'cancelada',   // 'normal' (padrão) | 'cancelada' | 'substituida' → marca d'água
  canhoto: false,          // padrão true: imprime o canhoto, como o portal
  logo: false,             // padrão: logomarca oficial (já incluída); caminho/Buffer troca; false = texto
  fontes: {                // TTF próprios; padrão: Helvetica (métrica equivalente à Arial)
    normal: 'arial.ttf',
    negrito: 'arialbd.ttf',
  },
});
```

**Por que a situação é uma opção?** O XML da NFS-e não muda quando a nota é cancelada ou substituída: isso
chega como um **evento** separado. Quem chama sabe a situação e a informa aqui.

**Logomarca.** A logomarca oficial da NFS-e, publicada pelo Comitê Gestor no
[portal da NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/logos-da-nfs-e), já vem no pacote
e sai no cabeçalho, como pede a NT (item 2.4.3). A marca é do governo: a licença MIT vale para o código, não para ela
(ver `assets/LEIAME.md`).

### Só os dados

Se você quer montar o próprio layout (HTML, e-mail, tela), use `lerNota`. Ela devolve os textos do DANFSe já
formatados (máscaras, descrições dos códigos, somas da NT):

```js
const { lerNota } = require('danfse-nacional');
const nota = lerNota(xml);
nota.identificacao.chave;          // '3550308211222333000181...'
nota.totais.valorLiquido;          // 'R$ 8.742,50'
nota.prestador.municipio;          // 'São Paulo / SP'
```

### Linha de comando

```bash
npx danfse-nacional nota.xml                  # grava nota.pdf (depois de instalar)
npx danfse-nacional nota.xml saida.pdf --cancelada --canhoto
npx danfse-nacional pasta-com-xmls/           # um PDF para cada XML
```

## Igual ao DANFSe do portal nacional

Onde a NT deixa margem de interpretação, a biblioteca segue o **DANFSe que o próprio portal nacional gera**.
A versão 0.2.0 foi conferida contra PDFs baixados do portal: o texto sai idêntico, palavra por palavra.

| Ponto | Como está (igual ao portal) |
|---|---|
| Campo sem informação no XML | Traço (`-`), nota 12; campos compostos mantêm um traço por parte: `17.19.01 / -` |
| Texto longo | Corta no limite de caracteres da NT (item 2.4.5) e acrescenta `...` |
| Cabeçalho | `Município: São Paulo - SP`, `Ambiente Gerador: 1`, `Tipo de Ambiente: 1` (códigos) |
| Código IBGE | `35.50308` |
| Regime especial "0 - Nenhum" | A linha do regime especial não é impressa |
| Nota sem IBS/CBS | Exclusões, Total do IBS/CBS e Valor líquido + IBS/CBS saem `R$ 0,00` |
| Tributos aproximados | `Federais: R$ x; Estaduais: R$ y; Municipais: R$ z;` (só o % do Simples → traços) |
| Canhoto | Impresso por padrão (`canhoto: false` tira) |
| PIS/COFINS próprios | Linha impressa só para competência até 2026 (nota 6) |
| Prestador sem nome ou endereço no DPS | Completado pelo grupo `emit` |
| Fontes | Helvetica no lugar de Arial / Microsoft Sans Serif (que não podem ser distribuídas); dá para trocar em `fontes` |

Encontrou divergência com o portal ou com a NT? Abra uma issue citando o item.

## Desenvolvimento

```bash
npm test                  # node --test
npm run exemplo           # gera os PDFs das notas de exemplo em exemplos/saida/
npm run gerar-municipios  # atualiza a tabela de municípios pela API do IBGE
```

As notas em `test/fixtures/` são **todas fictícias** e validadas contra o XSD oficial (esquemas v1.01).
**Nunca adicione XML de nota real**, nem "anonimizada à mão". Um teste recusa arquivo sem o aviso
`NOTA FICTÍCIA para testes` ou com assinatura digital.

As descrições dos códigos (`src/dados/dominios.js`) vêm da documentação dos esquemas oficiais. A tabela de
municípios vem da API do IBGE.

## Licença

[MIT](LICENSE). Não é um produto oficial da Receita Federal nem do Comitê Gestor da NFS-e.
