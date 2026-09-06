import sharp from 'sharp';
import { ProfileImageRepository } from '../repositories/profile-image.repository.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export class ProfileImageService {
  constructor(private readonly repository: ProfileImageRepository) {}

  async execute(userId: string, input: Buffer) {
    const initialSizeFormatted = formatBytes(input.length);
    console.log(`📥 [AVATAR UPLOAD] Recebido no backend | Usuario: ${userId} | Tamanho: ${initialSizeFormatted}`);

    try {
      const metadata = await sharp(input).metadata();
      console.log(`📐 [AVATAR ORIGINAL] Dimensoes: ${metadata.width || '?'}x${metadata.height || '?'} | Formato: ${metadata.format || 'unknown'}`);
    } catch (e) {
      console.log('📐 [AVATAR ORIGINAL] Nao foi possivel ler metadados da imagem');
    }

    const optimizedImage = await sharp(input)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'center' })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    const finalSizeFormatted = formatBytes(optimizedImage.length);
    const reductionPercent = (((input.length - optimizedImage.length) / input.length) * 100).toFixed(1);

    console.log(`⚡ [AVATAR SHARP COMPACTADO] Dimensoes finais: 512x512 (WebP 80%) | Tamanho final: ${finalSizeFormatted} | Reducao backend: ${reductionPercent}%`);

    const result = await this.repository.save(userId, optimizedImage);

    console.log(`✅ [AVATAR SALVO STORAGE & DB] URL: ${result.avatarUrl}`);

    return result;
  }
}
