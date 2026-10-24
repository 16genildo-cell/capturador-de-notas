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
    // Endereco da empresa
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
