import models from "@models";
import { logger } from "ts-rails";
import { isFcmEnabled, pushFcmToUser } from "./fcmPush";
import { toNotificationDto, parseNotificationData, stringifyNotificationData } from "./notificationMapper";
import { publishSseToUser } from "./sseHub";
import type {
  NotificationDto,
  RegisterPushTokenInput,
  SendNotificationInput,
  SendNotificationResult,
} from "./types";

export async function sendNotification(
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const userId = String(input.userId || "").trim();
  if (!userId) throw new Error("userId is required");

  const row = await models.appNotification.create({
    data: {
      userId,
      type: input.type ?? "info",
      title: String(input.title || "").trim() || "Notification",
      message: input.message?.trim() || null,
      data: stringifyNotificationData(input.data),
    },
  });

  const notification = toNotificationDto(row);

  let sseDelivered = false;
  if (input.realtime !== false) {
    sseDelivered = (await broadcastNotificationsCenter(userId)) > 0;
  }

  let pushedFcm = 0;
  if (input.push !== false && isFcmEnabled()) {
    pushedFcm = await pushFcmToUser(userId, notification);
  }

  return { notification, pushedFcm, sseDelivered };
}

export async function sendNotificationToMany(
  userIds: string[],
  payload: Omit<SendNotificationInput, "userId">,
): Promise<SendNotificationResult[]> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const out: SendNotificationResult[] = [];
  for (const userId of ids) {
    out.push(await sendNotification({ ...payload, userId }));
  }
  return out;
}

export async function listNotifications(
  userId: string,
  opts?: { limit?: number; unreadOnly?: boolean },
): Promise<NotificationDto[]> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 30));
  const rows = await models.appNotification.findMany({
    where: {
      userId,
      deleted: false,
      ...(opts?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toNotificationDto);
}

export async function countUnread(userId: string): Promise<number> {
  return models.appNotification.count({
    where: { userId, deleted: false, readAt: null },
  });
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<NotificationDto | null> {
  const row = await models.appNotification.findFirst({
    where: { id: notificationId, userId, deleted: false },
  });
  if (!row) return null;
  if (row.readAt) return toNotificationDto(row);

  const updated = await models.appNotification.update({
    where: { id: row.id },
    data: { readAt: new Date() },
  });
  const dto = toNotificationDto(updated);
  await broadcastNotificationsCenter(userId);
  return dto;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const r = await models.appNotification.updateMany({
    where: { userId, deleted: false, readAt: null },
    data: { readAt: new Date() },
  });
  await broadcastNotificationsCenter(userId);
  return r.count;
}

export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
  const token = input.token.trim();
  if (!token) throw new Error("token is required");
  const platform = input.platform.toUpperCase();
  if (!["ANDROID", "IOS", "WEB"].includes(platform)) {
    throw new Error("platform must be ANDROID, IOS, or WEB");
  }

  await models.userPushToken.upsert({
    where: { token },
    create: {
      userId: input.userId,
      token,
      platform,
      deviceId: input.deviceId ?? null,
      appVersion: input.appVersion ?? null,
      isActive: true,
      lastError: null,
    },
    update: {
      userId: input.userId,
      platform,
      deviceId: input.deviceId ?? null,
      appVersion: input.appVersion ?? null,
      isActive: true,
      lastError: null,
    },
  });
}

export async function unregisterPushToken(userId: string, token: string): Promise<void> {
  await models.userPushToken.updateMany({
    where: { userId, token: token.trim() },
    data: { isActive: false },
  });
}

/** Snapshot cho client SSE vừa kết nối. */
export async function buildSseConnectedPayload(userId: string): Promise<{
  unreadCount: number;
  notifications: NotificationDto[];
}> {
  const [unreadCount, notifications] = await Promise.all([
    countUnread(userId),
    listNotifications(userId, { limit: 20 }),
  ]);
  return { unreadCount, notifications };
}

export type NotificationsCenterPayload = {
  notifications: NotificationDto[];
  unreadCount: number;
  generatedAt: string;
};

/** Payload dropdown navbar (trung tâm thông báo). */
export async function loadNotificationsCenterPayload(
  userId: string,
): Promise<NotificationsCenterPayload> {
  const base = await buildSseConnectedPayload(userId);
  return {
    notifications: base.notifications,
    unreadCount: base.unreadCount,
    generatedAt: new Date().toISOString(),
  };
}

/** Push full snapshot tới mọi tab SSE của user. */
export async function broadcastNotificationsCenter(userId: string): Promise<number> {
  try {
    const payload = await loadNotificationsCenterPayload(userId);
    return publishSseToUser(userId, "snapshot", payload);
  } catch (e) {
    logger.warn({ userId, err: String(e) }, "[notifications] broadcast center failed");
    return 0;
  }
}

export async function softDeleteNotification(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const r = await models.appNotification.updateMany({
    where: { id: notificationId, userId, deleted: false },
    data: { deleted: true },
  });
  return r.count > 0;
}

/** Tiện ích: log khi gửi lỗi nhưng không throw. */
export async function sendNotificationSafe(
  input: SendNotificationInput,
): Promise<SendNotificationResult | null> {
  try {
    return await sendNotification(input);
  } catch (e) {
    logger.error({ err: String(e), userId: input.userId }, "[notifications] send failed");
    return null;
  }
}

export { parseNotificationData, toNotificationDto };
