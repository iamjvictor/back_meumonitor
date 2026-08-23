import sharp from 'sharp';
import { ProfileImageRepository } from '../repositories/profile-image.repository.js';

export class ProfileImageService {
  constructor(private readonly repository: ProfileImageRepository) {}

  async execute(userId: string, input: Buffer) {
    console.log('Processamento da imagem iniciado', {
      event: 'teacher.avatar_processing_started',
      userId,
      inputBytes: input.length,
    });

    const optimizedImage = await sharp(input)
      .rotate()
      .resize(1024, 1024, { fit: 'cover', position: 'attention' })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();

    const result = await this.repository.save(userId, optimizedImage);

    console.log('Imagem processada e salva', {
      event: 'teacher.avatar_processing_completed',
      userId,
      inputBytes: input.length,
      outputBytes: optimizedImage.length,
      compressionRatio: Number((optimizedImage.length / input.length).toFixed(3)),
      avatarUrl: result.avatarUrl,
    });

    return result;
  }
}
