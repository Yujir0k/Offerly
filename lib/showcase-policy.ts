/** Public synthetic fixtures are opt-in in production and enabled for local presentation. */
export function showcaseEnabled() {
  return (
    process.env.ENABLE_DEMO_DATA === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.ENABLE_DEMO_DATA !== "false")
  );
}
