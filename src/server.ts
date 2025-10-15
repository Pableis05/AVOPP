import express from 'express';
import path from 'path';
import cors from 'cors';
import { PrismaClient, Activity, ActivityStatus, ActivityType, PriorityMode } from '@prisma/client';
import { differenceInHours, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir, { index: 'index.html' }));

// Serve landing page explicitly for '/'
app.get('/', (_req, res) => {
  console.log('GET / -> index.html');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Note: no wildcard fallback needed; static middleware serves index.html at '/'

const TIMEZONE = 'America/Bogota';

type RankedActivity = Activity & { score: number; color: 'red' | 'yellow' | 'green' | 'none'; prioritySource: 'auto' | 'manual' };

function computeColorByDue(hoursRemaining: number | null): 'red' | 'yellow' | 'green' | 'none' {
  if (hoursRemaining === null) return 'none';
  if (hoursRemaining <= 48) return 'red';
  if (hoursRemaining >= 72 && hoursRemaining <= 120) return 'yellow';
  if (hoursRemaining > 120) return 'green';
  return 'none';
}

function computeTypeBase(type: ActivityType): number {
  switch (type) {
    case 'examen':
      return 100;
    case 'entrega':
    case 'tarea':
      return 70;
    case 'lectura':
      return 40;
    case 'clase':
    default:
      return 10;
  }
}

function computeStateAdjust(status: ActivityStatus): number {
  switch (status) {
    case 'pending':
      return 20;
    case 'in_progress':
      return 10;
    case 'completed':
      return -100;
    default:
      return 0;
  }
}

function rankActivity(a: Activity, nowUtc: Date): RankedActivity {
  const typeBase = computeTypeBase(a.type);
  const stateAdj = computeStateAdjust(a.status);
  let hoursRemaining: number | null = null;
  if (a.dueAt) {
    hoursRemaining = Math.max(1, differenceInHours(a.dueAt, nowUtc));
  }
  const urgency = hoursRemaining ? 200 / hoursRemaining : 0;
  const autoScore = typeBase + stateAdj + urgency;

  let score = autoScore;
  let prioritySource: 'auto' | 'manual' = 'auto';
  if (a.priority === 'manual' && a.manualPriority != null) {
    score = a.manualPriority;
    prioritySource = 'manual';
  }
  const color = computeColorByDue(hoursRemaining);
  return Object.assign({}, a, { score, color, prioritySource });
}

// Subjects
app.get('/api/subjects', async (_req, res) => {
  const items = await prisma.subject.findMany({ orderBy: { name: 'asc' } });
  res.json(items);
});

app.post('/api/subjects', async (req, res) => {
  const { name, code, color } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const item = await prisma.subject.create({ data: { name, code, color } });
    res.status(201).json(item);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'failed to create subject' });
  }
});

// Activities CRUD and listing
app.get('/api/activities', async (req, res) => {
  const { subjectId, type, status } = req.query as Record<string, string | undefined>;
  const where: any = {};
  if (subjectId) where.subjectId = subjectId;
  if (type) where.type = type;
  if (status) where.status = status;
  const items = await prisma.activity.findMany({ where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }] });
  res.json(items);
});

app.post('/api/activities', async (req, res) => {
  const { subjectId, type, name, description, startAt, dueAt } = req.body ?? {};
  if (!subjectId || !type || !name) return res.status(400).json({ error: 'subjectId, type, name are required' });
  try {
    const item = await prisma.activity.create({
      data: {
        subjectId,
        type,
        name,
        description: description ?? null,
        startAt: startAt ? new Date(startAt) : null,
        dueAt: dueAt ? new Date(dueAt) : null,
      },
    });
    res.status(201).json(item);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'failed to create activity' });
  }
});

// Ranking endpoint — declared BEFORE /api/activities/:id to avoid shadowing
app.get('/api/activities/ranking', async (req, res) => {
  const { subjectId } = req.query as Record<string, string | undefined>;
  const where: any = { NOT: { type: 'clase' } };
  if (subjectId) where.subjectId = subjectId;
  const items = await prisma.activity.findMany({ where });
  const nowUtc = new Date();
  const ranked = items.map(a => rankActivity(a, nowUtc));
  ranked.sort((a, b) => (b.score - a.score) || ((a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0)) || (computeTypeBase(b.type) - computeTypeBase(a.type)));
  res.json(ranked);
});

app.get('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const item = await prisma.activity.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.patch('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, startAt, dueAt, status, priority, manualPriority, completedAt, completedBy } = req.body ?? {};
  try {
    const updateData: any = {
      name,
      description,
      startAt: startAt === undefined ? undefined : startAt ? new Date(startAt) : null,
      dueAt: dueAt === undefined ? undefined : dueAt ? new Date(dueAt) : null,
      status,
      priority,
      manualPriority,
    };

    // Handle completion audit fields
    if (completedAt !== undefined) {
      updateData.completedAt = completedAt ? new Date(completedAt) : null;
    }
    if (completedBy !== undefined) {
      updateData.completedBy = completedBy;
    }

    const item = await prisma.activity.update({
      where: { id },
      data: updateData,
    });
    res.json(item);
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'failed to update activity' });
  }
});

app.post('/api/activities/:id/toggle-completed', async (req, res) => {
  const { id } = req.params;
  const current = await prisma.activity.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: 'not found' });
  
  const nextStatus: ActivityStatus = current.status === 'completed' ? 'pending' : 'completed';
  const updateData: any = { status: nextStatus };
  
  // Set completion audit fields
  if (nextStatus === 'completed') {
    updateData.completedAt = new Date();
    updateData.completedBy = 'student'; // For now, hardcoded. Could be from auth context
  } else {
    // Clear completion fields when unmarking as completed
    updateData.completedAt = null;
    updateData.completedBy = null;
  }
  
  const updated = await prisma.activity.update({ where: { id }, data: updateData });
  res.json(updated);
});

// (moved ranking route above)

// Day panel
app.get('/api/day', async (_req, res) => {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const classes = await prisma.activity.findMany({
    where: { type: 'clase', startAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { startAt: 'asc' },
  });
  const dueToday = await prisma.activity.findMany({
    where: { NOT: { type: 'clase' }, dueAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { dueAt: 'asc' },
  });
  res.json({ date: now.toISOString(), classes, activities: dueToday });
});

// Weekly summary (Mon-Sun based on locale; using Monday as start of week)
app.get('/api/weekly-summary', async (_req, res) => {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const items = await prisma.activity.findMany({
    where: { dueAt: { gte: weekStart, lte: weekEnd }, type: { in: ['examen', 'entrega', 'tarea'] } },
  });
  const byDay = new Map<string, { date: string; entregas: number; examenes: number }>();
  for (let d = new Date(weekStart); d <= weekEnd; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const key = startOfDay(d).toISOString();
    byDay.set(key, { date: key, entregas: 0, examenes: 0 });
  }
  for (const it of items) {
    if (!it.dueAt) continue;
    const key = startOfDay(it.dueAt).toISOString();
    const bucket = byDay.get(key);
    if (!bucket) continue;
    if (it.type === 'examen') bucket.examenes += 1;
    else bucket.entregas += 1; // include tarea/entrega
  }
  res.json({ range: { start: weekStart.toISOString(), end: weekEnd.toISOString() }, days: Array.from(byDay.values()) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AVOPP API running on http://localhost:${PORT}`);
});



