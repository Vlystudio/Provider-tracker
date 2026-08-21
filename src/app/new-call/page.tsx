import { redirect } from 'next/navigation';
import { requirePagePermission } from '@/server/authorization';

export default async function NewCallPage() {
  await requirePagePermission('operations:write');
  redirect('/authorization-summary');
}
