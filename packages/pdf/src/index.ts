// @fieldline/pdf: @react-pdf/renderer templates (roof report, curb estimate, proposal, invoice,
// signature certificate). Every document renders deterministically from a snapshot JSON object.
export * from './snapshots';
export * from './format';
export { collectText } from './text';
export {
  PDF_TEMPLATES_VERSION,
  canonicalJson,
  countPages,
  documentFor,
  renderToBuffer,
  sha256Hex,
  type RenderedPdf,
} from './render';
export { RoofReportDocument, structureTotals, type RoofTotals } from './templates/roof-report';
export {
  CurbEstimateDocument,
  GATE_LABEL,
  InvoiceDocument,
  ProposalDocument,
  SignatureCertificateDocument,
  gatesClear,
} from './templates/business';
