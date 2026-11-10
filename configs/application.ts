import * as channels from "@channels";
import { ApplicationController } from "@controllers/application.controller";
import { appCodePath, appPath, vendorPath } from "@lib/utils/path";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import flash from "express-flash";
import methodOverride from "method-override";
import { MiddlewareFactory, RailsApplication, viewHelpers } from "ts-rails";
import env from "./env";
import {
  initializeCache,
  initializeJobs,
  initializeLogger,
  initializeMailer,
  initializeSession,
} from "./initializers";
import { initializeHash } from "./initializers/hash";
import { setupJobWorkers } from "@lib/jobs/setupWorkers";
import {
  buildCorsOptions,
  csrfGuardMiddleware,
  parseTrustProxy,
  securityHeadersMiddleware,
  i18nMiddleware,
  initI18n,
  rateLimitMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
  initSwaggerDocument,
  setupSwagger,
} from "./plugins";
import { Route } from "./routes";

// Configure the middleware factory for the entire application.
RailsApplication.middlewareFactory = {
  rateLimit: rateLimitMiddleware,
  requestId: () => requestIdMiddleware,
  requestLogging: () => requestLoggingMiddleware,
} as MiddlewareFactory;

// Register all channel classes for Socket.io
RailsApplication.channelClasses = Object.values(channels);

export class Application extends RailsApplication {
  private i18nReady: Promise<void> | null = null;

  constructor() {
    super();
    this.setupConfig();
  }

  /** Thay `ts-rails` `loadConcerns`: bỏ `*.d.ts` và barrel `index.*`. */
  protected async loadConcerns(
    targetPrototype: object,
    directory: string,
  ): Promise<void> {
    const fullPath = path.resolve(process.cwd(), directory);
    if (!fs.existsSync(fullPath)) return;
    for (const file of fs.readdirSync(fullPath)) {
      if (file.endsWith(".d.ts")) continue;
      if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
      if (file === "index.ts" || file === "index.js") continue;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(path.join(fullPath, file)) as {
        default?: object;
        [k: string]: unknown;
      };
      const methods =
        mod.default ?? (Object.values(mod)[0] as object | undefined);
      if (methods && typeof methods === "object") {
        Object.assign(targetPrototype, methods);
      }
    }
  }

  /** JSON mặc định 100kb — tăng để chat AI gửi ảnh base64. */
  protected setupStandardMiddlewares(): void {
    if (!RailsApplication.middlewareFactory) {
      throw new Error("RailsApplication.middlewareFactory has not been configured.");
    }
    // IRW-FIX-058: IP thật phía sau proxy/LB (rate limit theo IP cần giá trị này đúng).
    const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
    if (trustProxy !== undefined) this.app.set("trust proxy", trustProxy);
    // IRW-FIX-053: header bảo mật cho mọi response.
    this.app.use(securityHeadersMiddleware());
    this.app.use(RailsApplication.middlewareFactory.requestId());
    this.app.use(RailsApplication.middlewareFactory.requestLogging());
    this.app.use(express.json({ limit: "12mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "12mb" }));
    this.app.use(methodOverride("_method"));
    this.app.use(cookieParser());
    this.app.use(RailsApplication.middlewareFactory.rateLimit());
    this.app.use((req, res, next) => {
      (res.locals as { h?: typeof viewHelpers }).h = viewHelpers;
      next();
    });
  }

  protected setupConfig() {
    this.port = env.port || "8000";
  }

  // Phương thức mới để chạy tất cả các Initializer
  protected runInitializers() {
    initSwaggerDocument();
    initializeLogger();
    initializeHash();

    initializeMailer();
    initializeJobs();

    initializeCache();
    // Thêm các initializer khác vào đây
  }

  /**
   * Hiện thực hóa logic Worker cho BullMQ tại đây
   */
  protected startBackgroundProcessor() {
    setupJobWorkers();
  }

  protected setupViewEngine() {
    this.app.set("views", appPath("views"));
    this.app.set("view engine", "pug");
  }

  protected setupAppMiddlewares() {
    // IRW-FIX-053: CORS theo danh sách; không còn `origin:true`+credentials khi thiếu CORS_ORIGIN ở production.
    this.app.use(cors(buildCorsOptions()));
    // IRW-FIX-053: chặn CSRF cho form dùng cookie session (Origin/Referer phải cùng host).
    this.app.use(csrfGuardMiddleware());

    const sessionMiddleware = initializeSession();

    // If we want purely stateless API, we could conditionalize this:
    this.app.use((req, res, next) => {
      const isStateless =
        req.path.startsWith("/api") ||
        req.path.startsWith("/docs") ||
        req.path.startsWith("/swagger.json");

      if (isStateless) return next();

      sessionMiddleware(req, res, (err) => {
        if (err) return next(err);
        flash()(req, res, next);
      });
    });

    this.app.use(i18nMiddleware);
  }

  protected async setupServices() {
    if (this.i18nReady) return await this.i18nReady;

    this.i18nReady = initI18n();
    await this.i18nReady;
  }

  protected setupStaticFiles() {
    // 1. App Assets
    this.app.use(express.static(appPath("assets")));

    // 2. Vendor Assets (Refactored to be cleaner)
    const vendors = [
      { path: "/css", dir: vendorPath("bootstrap", "dist/css") },
      { path: "/css/font-awesome", dir: vendorPath("font-awesome") },
      { path: "/js", dir: vendorPath("@popperjs/core", "dist/umd") },
      { path: "/js", dir: vendorPath("bootstrap", "dist/js") },
      { path: "/js", dir: vendorPath("jquery", "dist") },
      { path: "/js", dir: vendorPath("vue", "dist") },
    ];

    vendors.forEach((v) => {
      this.app.use(v.path, express.static(v.dir));
    });
  }

  protected mountRoutes() {
    this.app.use("/", Route.draw());
  }

  protected setupSwagger() {
    if (env.appEnv === "development") {
      setupSwagger(this.app);
      this.getRoutes();
    }
  }

  public async initialize() {
    this.runInitializers();
    this.setupViewEngine();
    this.setupAppMiddlewares();

    // Tự động load tất cả Controller Concerns
    await this.loadConcerns(
      ApplicationController.prototype,
      appCodePath("controllers", "concerns"),
    );

    this.setupStaticFiles();
    await this.setupServices();
    this.bootstrap();
  }

  public async run() {
    await this.initialize();
    await super.run();
  }
}

export default new Application();
