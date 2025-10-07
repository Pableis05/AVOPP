import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  await prisma.activity.deleteMany();
  await prisma.subject.deleteMany();

  await prisma.subject.createMany({
    data: [
      { name: 'Cálculo I', code: 'CAL1', color: '#2563eb' },
      { name: 'Programación', code: 'PROG', color: '#16a34a' },
      { name: 'Física', code: 'FIS', color: '#f59e0b' },
    ],
  });

  const subjList = await prisma.subject.findMany();
  const byCode = Object.fromEntries(subjList.map(s => [s.code!, s]));

  const now = new Date();
  const hour = 3600 * 1000;
  const day = 24 * hour;

  await prisma.activity.createMany({
    data: [
      // Classes today
      { subjectId: byCode['CAL1'].id, type: 'clase', name: 'Clase magistral', startAt: new Date(now.getTime() + 2 * hour) },
      { subjectId: byCode['PROG'].id, type: 'clase', name: 'Laboratorio', startAt: new Date(now.getTime() + 5 * hour) },

      // Tasks and exams
      { subjectId: byCode['CAL1'].id, type: 'tarea', name: 'Taller derivadas', dueAt: new Date(now.getTime() + 36 * hour) },
      { subjectId: byCode['PROG'].id, type: 'entrega', name: 'Proyecto API', dueAt: new Date(now.getTime() + 4 * day) },
      { subjectId: byCode['FIS'].id, type: 'examen', name: 'Parcial 1', dueAt: new Date(now.getTime() + 6 * day) },
      { subjectId: byCode['PROG'].id, type: 'lectura', name: 'Capítulo 3', dueAt: new Date(now.getTime() + 7 * day) },

      // Additional near-due to populate ranking clearly
      { subjectId: byCode['PROG'].id, type: 'examen', name: 'Quiz sorpresa', dueAt: new Date(now.getTime() + 12 * hour) },
      { subjectId: byCode['CAL1'].id, type: 'entrega', name: 'Práctica límites', dueAt: new Date(now.getTime() + 24 * hour) },
      { subjectId: byCode['FIS'].id, type: 'tarea', name: 'Problemas cinemática', dueAt: new Date(now.getTime() + 72 * hour) },
    ],
  });

  // One manual priority override
  const tarea = await prisma.activity.findFirst({ where: { type: 'tarea' } });
  if (tarea) {
    await prisma.activity.update({ where: { id: tarea.id }, data: { priority: 'manual', manualPriority: 250 } });
  }

  console.log('Seed data inserted.');
}

run().finally(async () => {
  await prisma.$disconnect();
});


