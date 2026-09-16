import { IGLOUE_SERVER_SERVICE_WINDOWS } from "./validation.ts";

export const IGLOUE_SERVER_FLEET_TURNAROUND = Object.freeze({
  timeZone: "Europe/Paris",
  preparationBufferMinutes: 120,
  turnaroundBufferMinutes: 240,
});

function getServiceWindow(slotId: string) {
  return IGLOUE_SERVER_SERVICE_WINDOWS.find(
    (serviceWindow) => serviceWindow.id === slotId,
  ) ?? null;
}

function getCivilMinute(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );

  if (!match) {
    return NaN;
  }

  const [, year, month, day, hours, minutes] = match;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
  ) / 60000;
}

function formatCivilMinute(value: number) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 60000)
    .toISOString()
    .slice(0, 16);
}

export function buildServerOperationalPeriod(
  deliveryDate: string,
  deliverySlotId: string,
  collectionDate: string,
  collectionSlotId: string,
) {
  const deliveryWindow = getServiceWindow(deliverySlotId);
  const collectionWindow = getServiceWindow(collectionSlotId);

  if (!deliveryWindow || !collectionWindow) {
    return {
      ok: false as const,
      error: "Invalid service window",
    };
  }

  const deliveryStartMinute = getCivilMinute(
    `${deliveryDate}T${deliveryWindow.startTime}`,
  );

  const collectionEndMinute = getCivilMinute(
    `${collectionDate}T${collectionWindow.endTime}`,
  );

  const operationalStartMinute =
    deliveryStartMinute -
    IGLOUE_SERVER_FLEET_TURNAROUND.preparationBufferMinutes;

  const operationalEndMinute =
    collectionEndMinute +
    IGLOUE_SERVER_FLEET_TURNAROUND.turnaroundBufferMinutes;

  if (
    !Number.isFinite(operationalStartMinute) ||
    !Number.isFinite(operationalEndMinute) ||
    operationalStartMinute >= operationalEndMinute
  ) {
    return {
      ok: false as const,
      error: "Invalid operational period",
    };
  }

  const operationalStart =
    formatCivilMinute(operationalStartMinute);

  const operationalEnd =
    formatCivilMinute(operationalEndMinute);

  if (!operationalStart || !operationalEnd) {
    return {
      ok: false as const,
      error: "Invalid operational period",
    };
  }

  return {
    ok: true as const,
    operationalPeriod: {
      timeZone: IGLOUE_SERVER_FLEET_TURNAROUND.timeZone,
      preparationBufferMinutes:
        IGLOUE_SERVER_FLEET_TURNAROUND.preparationBufferMinutes,
      turnaroundBufferMinutes:
        IGLOUE_SERVER_FLEET_TURNAROUND.turnaroundBufferMinutes,
      deliveryWindowStart:
        `${deliveryDate}T${deliveryWindow.startTime}`,
      collectionWindowEnd:
        `${collectionDate}T${collectionWindow.endTime}`,
      operationalStart,
      operationalEnd,
    },
  };
}