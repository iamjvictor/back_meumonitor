import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function findTopicProfileContext(topicId: string) {
  return prisma.monitorTopic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      name: true,
      definition: true,
      aiDefinition: true,
      subjectId: true,
      subject: {
        select: {
          monitorId: true,
          monitor: { select: { teacherId: true } },
        },
      },
    },
  });
}

export async function findTopicProfileContextsForSubject(subjectId: string) {
  return prisma.monitorTopic.findMany({
    where: { subjectId },
    select: {
      id: true,
      name: true,
      definition: true,
      aiDefinition: true,
      subjectId: true,
      subject: {
        select: {
          monitorId: true,
          monitor: { select: { teacherId: true } },
        },
      },
    },
    orderBy: { position: 'asc' },
  });
}

export async function saveGeneratedTopicProfile(input: {
  topicId: string;
  definition: string;
  classificationGuidance: string;
  model: string;
  sourceChunkIds: string[];
}) {
  return prisma.monitorTopic.update({
    where: { id: input.topicId },
    data: {
      aiDefinition: input.definition,
      aiClassificationGuidance: input.classificationGuidance,
      aiDefinitionModel: input.model,
      aiDefinitionSources: input.sourceChunkIds as unknown as Prisma.InputJsonValue,
      aiDefinitionUpdatedAt: new Date(),
    },
  });
}
