import * as jobs from "@jobs";
import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { execSync } from "child_process";
import serverless from "serverless-http";
import application from "./configs/application";

let cachedHandler: serverless.Handler | undefined;
let initialized: Promise<void> | undefined;

type JobClass = { new (): { perform: (...args: unknown[]) => Promise<unknown> } };

/** Sự kiện EventBridge/CloudWatch có thể đến ở BẤT KỲ lần gọi nào, không chỉ cold start (IRW-FIX-062). */
function isScheduledEvent(event: Record<string, unknown>): boolean {
  return event.source === "aws.events" || event["detail-type"] === "Scheduled Event";
}

export const handler = async (
  event: APIGatewayProxyEvent | Record<string, unknown>,
  context: Context,
) => {
  initialized ??= application.initialize();
  await initialized;

  const eventAny = event as Record<string, unknown>;
  if (isScheduledEvent(eventAny)) {
    const jobClassName = (eventAny.job ||
      (eventAny.detail as Record<string, string> | undefined)?.job) as string;
    const jobMap = jobs as unknown as Record<string, unknown>;
    const JobClass = jobMap[jobClassName] as JobClass | undefined;
    if (!JobClass) {
      console.error("[lambda] Unknown scheduled job:", jobClassName);
      return { statusCode: 400, body: "Unknown job" };
    }
    const args = (eventAny.args as unknown[]) || [];
    return await new JobClass().perform(...args);
  }

  // Cấu hình serverless-http để Express hiểu event từ API Gateway.
  cachedHandler ??= serverless(application.app, {
    binary: ["image/*", "font/*", "application/pdf"],
  });

  // Ngăn Lambda kết thúc trước khi các async tasks trong event loop hoàn tất (nếu có)
  context.callbackWaitsForEmptyEventLoop = false;

  return cachedHandler(event, context);
};

/**
 * Handler dành riêng cho việc chạy migration.
 * Anh có thể gọi handler này thủ công từ AWS Console hoặc qua CI/CD.
 */
export const migrate = async () => {
  try {
    console.log("Starting database migration...");
    // Prisma migrate deploy là lệnh an toàn cho production (không làm mất dữ liệu)
    const output = execSync("npx prisma migrate deploy");
    console.log(output.toString());
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Migration successful",
        output: output.toString(),
      }),
    };
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
};

/**
 * Handler để xử lý lỗi khi migration bị kẹt (Failed state).
 * Tham số 'migrationName' là tên thư mục migration bị lỗi.
 */
export const resolveMigration = async (event: { migrationName: string }) => {
  try {
    console.log(`Marking migration ${event.migrationName} as rolled back...`);
    const output = execSync(
      `npx prisma migrate resolve --rolled-back ${event.migrationName}`,
    );
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Migration resolved successfully",
        output: output.toString(),
      }),
    };
  } catch (error) {
    console.error("Resolve failed:", error);
    throw error;
  }
};
