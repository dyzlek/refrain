import { io, type Socket as IoSocket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@shared/protocol';

export type Socket = IoSocket<ServerToClient, ClientToServer>;

export const socket: Socket = io({
  transports: ['websocket'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});

// Le serveur mesure notre aller-retour : on répond tout de suite.
socket.on('probe', (ack) => ack());
