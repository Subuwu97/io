const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");

const defaults = {
  publicUrl: "",
  emailEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpFrom: "",
  discordEnabled: false,
  discordClientId: "",
  discordClientSecret: "",
};
function email(value) {
  const result = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    result.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(result)
  )
    throw new Error("Enter a valid email address");
  return result;
}
function publicUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Use an HTTPS address, or localhost for testing");
  return url.origin;
}
function createServices(
  directory,
  { transportFactory = nodemailer.createTransport } = {},
) {
  const file = path.join(directory, "services.json");
  let config = { ...defaults };
  if (fs.existsSync(file))
    config = { ...config, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  function get() {
    return { ...config };
  }
  function status() {
    return {
      email: !!(
        config.emailEnabled &&
        config.publicUrl &&
        config.smtpHost &&
        config.smtpFrom
      ),
      discord: !!(
        config.discordEnabled &&
        config.publicUrl &&
        config.discordClientId &&
        config.discordClientSecret
      ),
    };
  }
  function view() {
    const { smtpPassword, discordClientSecret, ...safe } = config;
    return {
      ...safe,
      smtpPasswordConfigured: !!smtpPassword,
      discordClientSecretConfigured: !!discordClientSecret,
      ...status(),
      discordRedirect: config.publicUrl
        ? config.publicUrl + "/api/auth/discord/callback"
        : "",
    };
  }
  function save(input) {
    const next = { ...config };
    for (const key of ["emailEnabled", "smtpSecure", "discordEnabled"]) {
      if (typeof input[key] !== "boolean")
        throw new Error("Invalid service option");
      next[key] = input[key];
    }
    next.publicUrl = publicUrl(input.publicUrl || "");
    for (const key of ["smtpHost", "smtpUser", "smtpFrom", "discordClientId"]) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > 254 ||
        /[\r\n]/.test(input[key])
      )
        throw new Error("Invalid service setting");
      next[key] = input[key].trim();
    }
    next.smtpPort = Number(input.smtpPort);
    if (
      !Number.isInteger(next.smtpPort) ||
      next.smtpPort < 1 ||
      next.smtpPort > 65535
    )
      throw new Error("Invalid SMTP port");
    for (const key of ["smtpPassword", "discordClientSecret"]) {
      if (input[key] !== undefined && input[key] !== "") {
        if (typeof input[key] !== "string" || input[key].length > 4096)
          throw new Error("Invalid service credential");
        next[key] = input[key];
      }
    }
    if (next.smtpFrom) next.smtpFrom = email(next.smtpFrom);
    if (next.smtpHost && /[\s/@]/.test(next.smtpHost))
      throw new Error("Enter an SMTP hostname without a URL");
    if (next.discordClientId && !/^\d{5,30}$/.test(next.discordClientId))
      throw new Error("Invalid Discord client ID");
    if (
      next.emailEnabled &&
      (!next.publicUrl || !next.smtpHost || !next.smtpFrom)
    )
      throw new Error(
        "Set the public address, SMTP host and sender before enabling email",
      );
    if (
      next.discordEnabled &&
      (!next.publicUrl || !next.discordClientId || !next.discordClientSecret)
    )
      throw new Error(
        "Set the public address and Discord credentials before enabling sign-in",
      );
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
    config = next;
    return view();
  }
  async function send(to, subject, text, attachments = []) {
    if (!status().email) throw new Error("Email delivery is not configured");
    if (
      !Array.isArray(attachments) ||
      attachments.some(
        (a) =>
          a.filename !== "I-O-account.zip" ||
          !Buffer.isBuffer(a.content) ||
          a.content.length > 8 * 1024 * 1024,
      )
    )
      throw new Error("Invalid export attachment");
    const transporter = transportFactory({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTLS: !config.smtpSecure,
      ...(config.smtpUser
        ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
        : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transporter.sendMail({
        from: { name: "I/O", address: config.smtpFrom },
        to: email(to),
        subject,
        text,
        attachments,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } finally {
      transporter.close?.();
    }
  }
  return { get, status, view, save, send };
}
module.exports = { createServices, email, publicUrl };
