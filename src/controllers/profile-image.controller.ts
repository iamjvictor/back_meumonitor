import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProfileImageRepositoryError } from '../repositories/profile-image.repository.js';
import { ProfileImageService } from '../services/profile-image.service.js';

export class ProfileImageController {
  constructor(private readonly service: ProfileImageService) {}

  async upload(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Sessao de usuario obrigatoria.' });
    if (request.user.role !== 'teacher') return reply.code(403).send({ error: 'FORBIDDEN', message: 'Apenas professores podem enviar foto de perfil.' });

    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'IMAGE_REQUIRED', message: 'Envie uma imagem no campo file.' });
    if (!part.mimetype.startsWith('image/')) return reply.code(415).send({ error: 'UNSUPPORTED_IMAGE_TYPE', message: 'O arquivo precisa ser uma imagem.' });

    try {
      const input = await part.toBuffer();
      const result = await this.service.execute(request.user.id, input);
      return reply.code(200).send({ data: result });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'IMAGE_TOO_LARGE', message: 'A imagem deve ter no maximo 5 MB.' });
      }

      if (error instanceof ProfileImageRepositoryError) {
        console.log('Falha no storage da imagem', { event: 'teacher.avatar_storage_failed', requestId: request.id, userId: request.user.id, error });
        return reply.code(502).send({ error: 'IMAGE_STORAGE_FAILED', message: 'Nao foi possivel salvar a imagem.' });
      }

      console.log('Falha no processamento da imagem', { event: 'teacher.avatar_processing_failed', requestId: request.id, userId: request.user.id, error });
      return reply.code(400).send({ error: 'IMAGE_PROCESSING_FAILED', message: 'Nao foi possivel processar a imagem.' });
    }
  }
}
