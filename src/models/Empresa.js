import mongoose from 'mongoose';
import { formatarDocumento, tipoPessoa } from '../utils/documento.js';

const empresaSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    razaoSocial: { type: String, required: true, trim: true },
    nomeFantasia: { type: String, trim: true },
    // CNPJ (empresa) ou CPF (pessoa fisica), somente digitos.
    cnpj: { type: String, required: true, trim: true, index: true },
    inscricaoEstadual: { type: String, trim: true },
    inscricaoMunicipal: { type: String, trim: true },
    uf: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 },
    municipioCodigo: { type: String, trim: true }, // codigo IBGE do municipio
    municipioNome: { type: String, trim: true },
    // Endereco do emitente (obrigatorio na NF-e / NFC-e)
    endereco: {
      logradouro: { type: String, trim: true },
      numero: { type: String, trim: true },
      complemento: { type: String, trim: true },
      bairro: { type: String, trim: true },
      cep: { type: String, trim: true },
      fone: { type: String, trim: true },
    },

    certificado: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificado' },

    // Controle incremental da Distribuicao DF-e (NF-e):
    // guarda o ultimo NSU (numero sequencial unico) ja consultado na SEFAZ.
    ultimoNSU: { type: String, default: '000000000000000' },
    maxNSU: { type: String, default: '000000000000000' },

    // Controle incremental da NFS-e nacional (ADN): ultimo NSU ja baixado.
    ultimoNSUNfse: { type: String, default: '0' },

    // Controle incremental da Distribuicao de CT-e.
    ultimoNSUCte: { type: String, default: '000000000000000' },

    // Credenciais opcionais para portais municipais de NFS-e (robos).
    nfseMunicipal: {
      provedor: { type: String, trim: true }, // ex: "nacional", "ginfes", "issnet"
      usuario: { type: String, trim: true },
      senhaCriptografada: { type: String },
    },

    // Quais documentos capturar
    captura: {
      nfe: { type: Boolean, default: true }, // produtos
      nfse: { type: Boolean, default: true }, // servicos
      cte: { type: Boolean, default: true }, // transporte
    },

    // Emissao de NFS-e pelo Emissor Nacional (Sefin Nacional)
    emissaoNfse: {
      ativa: { type: Boolean, default: false },
      // producao = notas com valor fiscal; homologacao = "producao restrita" (testes, sem valor)
      ambiente: { type: String, enum: ['producao', 'homologacao'], default: 'homologacao' },
      // 1 = nao optante; 2 = MEI; 3 = ME/EPP do Simples Nacional
      opSimpNac: { type: String, enum: ['1', '2', '3'], default: '1' },
      // So para ME/EPP: 1 = tributos federais e municipal pelo SN; 2 = federais pelo SN e ISS fora; 3 = todos fora do SN
      regApTribSN: { type: String, enum: ['1', '2', '3'], default: '1' },
      regEspTrib: { type: String, default: '0' }, // 0 = nenhum regime especial
      pTotTribSN: { type: Number, default: 0 }, // ME/EPP: % aproximado dos tributos (Lei 12.741)
      serie: { type: String, default: '1' }, // faixa de aplicativo proprio: 1 a 49999
      // Ultimo nDPS aceito pela Sefin, por ambiente: { producao: n, homologacao: n }
      numeracao: { type: mongoose.Schema.Types.Mixed, default: {} },
      // Padroes do formulario
      cTribNac: { type: String, trim: true },
      cNBS: { type: String, trim: true },
      descricaoPadrao: { type: String, trim: true },
    },

    // Emissao de NF-e (modelo 55) e NFC-e (modelo 65) direto na SEFAZ do estado
    emissaoNfe: {
      ativa: { type: Boolean, default: false },
      // producao = notas com valor fiscal; homologacao = testes da SEFAZ (sem valor)
      ambiente: { type: String, enum: ['producao', 'homologacao'], default: 'homologacao' },
      // CRT: 1 = Simples Nacional; 2 = Simples (excesso de sublimite); 3 = Regime normal; 4 = MEI
      crt: { type: String, enum: ['1', '2', '3', '4'], default: '1' },
      serieNfe: { type: String, default: '1' },
      serieNfce: { type: String, default: '1' },
      // Ultimo numero usado por ambiente e modelo: { producao: { 55: n, 65: n }, homologacao: {...} }
      numeracao: { type: mongoose.Schema.Types.Mixed, default: {} },
      naturezaOperacao: { type: String, trim: true, default: 'Venda de mercadoria' },
      // Simples Nacional, CSOSN 101: aliquota do credito de ICMS que pode ser aproveitado
      pCredSN: { type: Number, default: 0 },
      cstPisCofins: { type: String, default: '49' },
      // NFC-e: Codigo de Seguranca do Contribuinte, por ambiente (gerado no portal da SEFAZ)
      csc: {
        producao: { id: { type: String, trim: true }, token: { type: String, trim: true } },
        homologacao: { id: { type: String, trim: true }, token: { type: String, trim: true } },
      },
      versaoQrCode: { type: String, default: '' }, // vazio = padrao da UF; '2' ou '3'
      // Responsavel tecnico pelo sistema emissor
      respTec: {
        cnpj: { type: String, trim: true },
        contato: { type: String, trim: true },
        email: { type: String, trim: true },
        fone: { type: String, trim: true },
      },
      infComplementarPadrao: { type: String, trim: true },
    },

    ativa: { type: Boolean, default: true },
  },
  { timestamps: true },
);

empresaSchema.virtual('cnpjFormatado').get(function cnpjFormatado() {
  return formatarDocumento(this.cnpj);
});

empresaSchema.virtual('tipoPessoa').get(function tipo() {
  return tipoPessoa(this.cnpj);
});

empresaSchema.set('toJSON', { virtuals: true });
empresaSchema.set('toObject', { virtuals: true });

export const Empresa = mongoose.model('Empresa', empresaSchema);
