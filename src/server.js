import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import session from "express-session";
import helmet from "helmet";
import morgan from "morgan";
import methodOverride from "method-override";

import { isProduction, readBool, validateConfig } from "./config.js";
import { getPool, isConfigured as isDatabaseConfigured, query } from "./db.js";
import { csrfProtection } from "./middleware/security.js";
import createStore from "./store.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import viewHelpers from "./utils/view-helpers.js";

validateConfig();

const app = express();
const store = createStore();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PgSession = connectPgSimple(session);

app.disable("x-powered-by");
app.set("trust proxy", readBool("TRUST_PROXY", isProduction) ? 1 : false);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'", "https://wa.me"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://code.jquery.com", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://unpkg.com"],
        upgradeInsecureRequests: isProduction ? [] : null
      }
    }
  })
);
app.use(morgan(isProduction ? "combined" : "dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    maxAge: isProduction ? "1d" : 0
  })
);

const sessionStore = isDatabaseConfigured()
  ? new PgSession({
      pool: getPool(),
      tableName: "user_sessions",
      createTableIfMissing: true
    })
  : undefined;

app.use(
  session({
    name: "lumin.sid",
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "development-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: readBool("COOKIE_SECURE", isProduction),
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(csrfProtection);

app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.admin = req.session.admin || null;
  res.locals.flash = req.session.flash || null;
  res.locals.helpers = viewHelpers;
  res.locals.brandName = "LuminTix";
  req.session.flash = null;

  try {
    res.locals.navCategories = await store.listCategories();
  } catch (error) {
    res.locals.navCategories = [];
  }

  next();
});

app.get("/healthz", async (req, res, next) => {
  try {
    if (isDatabaseConfigured()) {
      await query("SELECT 1");
    }

    res.json({
      status: "ok",
      database: isDatabaseConfigured() ? "configured" : "seeded-local",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.use("/", publicRoutes(store));
app.use("/admin", adminRoutes(store));

app.use((req, res) => {
  res.status(404).render("not-found", {
    title: "Page not found",
    layout: "layouts/main"
  });
});

app.use((error, req, res, next) => {
  if (!error.status || error.status >= 500) {
    console.error(error);
  }

  res.status(error.status || 500).render("error", {
    title: "Something went wrong",
    message: isProduction ? "The page could not be loaded." : error.message || "The page could not be loaded.",
    layout: "layouts/main",
    currentPath: req.path,
    admin: req.session?.admin || null,
    flash: null,
    helpers: viewHelpers,
    brandName: "LuminTix",
    navCategories: res.locals.navCategories || [],
    csrfToken: req.session?.csrfToken || ""
  });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  const mode = store.isDatabaseConfigured() ? "Neon/Postgres" : "seeded local data";
  console.log(`LuminTix running at http://localhost:${port} using ${mode}.`);
});
