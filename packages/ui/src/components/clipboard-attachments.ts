export interface MessageAttachment {
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
  base64: string;
}

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENTS_BYTES = 3 * 1024 * 1024;

export async function appendClipboardImages(attachments: readonly MessageAttachment[], files: readonly File[]): Promise<MessageAttachment[]> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (attachments.length + images.length > MAX_ATTACHMENTS) throw new Error(`Adicione no máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`);
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.sizeInBytes, 0) + images.reduce((total, image) => total + image.size, 0);
  if (totalBytes > MAX_ATTACHMENTS_BYTES) throw new Error('O tamanho total dos anexos não pode ultrapassar 3 MB.');
  const next = [...attachments];
  for (const image of images) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    const extension = image.type.slice('image/'.length).split('+')[0]?.replace(/[^a-z0-9]/gi, '') || 'png';
    next.push({ fileName: image.name || `imagem-colada.${extension}`, mimeType: image.type, sizeInBytes: image.size, base64: btoa(binary) });
  }
  return next;
}