import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import type { Actor, Role } from '../../auth/actor.js';

interface UserRow extends RowDataPacket {
  id: number;
  external_id: string | null;
  email: string;
  display_name: string;
  role: Role;
}

function toActor(row: UserRow): Actor {
  return {
    id: row.id,
    externalId: row.external_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

const SELECT_USER = `
  SELECT id, external_id, email, display_name, role
  FROM users
`;

export async function findByEmail(email: string): Promise<Actor | null> {
  const [rows] = await pool.execute<UserRow[]>(`${SELECT_USER} WHERE email = :email LIMIT 1`, {
    email,
  });
  const row = rows[0];
  return row ? toActor(row) : null;
}

