import { z } from 'zod';
import { isValidTimeZone } from './automation-time';

export const automationSettingsSchema = z.object({
  timeZone: z.string().min(1).max(80).refine(isValidTimeZone, 'Enter a valid IANA time zone.'),
  upcomingStaleDays: z.coerce.number().int().min(0).max(30),
  meaningfulWaitIncreaseDays: z.coerce.number().int().min(1).max(180),
  meaningfulWaitIncreasePercent: z.coerce.number().int().min(1).max(500),
  highPriorityEscalationDays: z.coerce.number().int().min(1).max(30),
  dailyDigestHour: z.coerce.number().int().min(0).max(23),
  weeklyDigestDay: z.coerce.number().int().min(1).max(7),
  batchSize: z.coerce.number().int().min(50).max(2_000),
});

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

export const defaultAutomationSettings: AutomationSettings = {
  timeZone: 'America/New_York',
  upcomingStaleDays: 7,
  meaningfulWaitIncreaseDays: 14,
  meaningfulWaitIncreasePercent: 50,
  highPriorityEscalationDays: 3,
  dailyDigestHour: 7,
  weeklyDigestDay: 1,
  batchSize: 500,
};
