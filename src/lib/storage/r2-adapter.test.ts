import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  // Each command just records its input so assertions can read it back off
  // the object handed to send().
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(readonly config: Record<string, unknown>) {}
      send = send;
    },
    PutObjectCommand: class extends Command {
      readonly kind = "put";
    },
    GetObjectCommand: class extends Command {
      readonly kind = "get";
    },
    HeadObjectCommand: class extends Command {
      readonly kind = "head";
    },
    DeleteObjectCommand: class extends Command {
      readonly kind = "delete";
    },
  };
});

import { R2Adapter, __resetR2ClientForTests } from "./r2-adapter";

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "rakshana-test",
};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  send.mockReset();
  __resetR2ClientForTests();
  setEnv(ENV);
});

afterEach(() => {
  setEnv(Object.fromEntries(Object.keys(ENV).map((k) => [k, undefined])));
  __resetR2ClientForTests();
});

describe("R2Adapter", () => {
  it("puts to the right bucket and key, preserving contentType", async () => {
    send.mockResolvedValue({});
    const r = await new R2Adapter().put("org/o1/branding/logo.png", Buffer.from("abc"), {
      contentType: "image/png",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.kind).toBe("put");
    expect(cmd.input.Bucket).toBe("rakshana-test");
    expect(cmd.input.Key).toBe("org/o1/branding/logo.png");
    expect(cmd.input.ContentType).toBe("image/png");
    expect(cmd.input.ContentLength).toBe(3);

    expect(r).toEqual({
      url: "/api/files/org/o1/branding/logo.png",
      key: "org/o1/branding/logo.png",
      size: 3,
      contentType: "image/png",
    });
  });

  it("strips a leading slash from the object key", async () => {
    send.mockResolvedValue({});
    await new R2Adapter().put("/org/o1/receipts/d1.pdf", Buffer.from("x"), {
      contentType: "application/pdf",
    });
    expect(send.mock.calls[0][0].input.Key).toBe("org/o1/receipts/d1.pdf");
  });

  it("rejects traversal keys", async () => {
    await expect(
      new R2Adapter().put("org/o1/../o2/secret.pdf", Buffer.from("x"), {
        contentType: "application/pdf",
      }),
    ).rejects.toThrow(/unsafe key/);
  });

  it("returns the stored contentType on get", async () => {
    const stream = {} as ReadableStream;
    send.mockResolvedValue({
      Body: { transformToWebStream: () => stream },
      ContentType: "application/pdf",
      ContentLength: 42,
    });
    const got = await new R2Adapter().get("org/o1/receipts/d1.pdf");
    expect(got).toEqual({ stream, contentType: "application/pdf", size: 42 });
  });

  it("falls back to octet-stream when the object has no contentType", async () => {
    send.mockResolvedValue({
      Body: { transformToWebStream: () => ({}) as ReadableStream },
      ContentLength: 1,
    });
    const got = await new R2Adapter().get("org/o1/receipts/d1.pdf");
    expect(got?.contentType).toBe("application/octet-stream");
  });

  it("returns null instead of throwing when the object is missing", async () => {
    send.mockRejectedValue(Object.assign(new Error("nope"), { name: "NoSuchKey" }));
    expect(await new R2Adapter().get("org/o1/receipts/missing.pdf")).toBeNull();

    send.mockRejectedValue(Object.assign(new Error("nope"), { name: "NotFound" }));
    expect(await new R2Adapter().stat("org/o1/receipts/missing.pdf")).toBeNull();
  });

  it("rethrows non-404 errors", async () => {
    send.mockRejectedValue(Object.assign(new Error("boom"), { name: "AccessDenied" }));
    await expect(new R2Adapter().get("org/o1/receipts/d1.pdf")).rejects.toThrow("boom");
  });

  it("names the missing env var instead of failing obscurely", async () => {
    setEnv({ R2_SECRET_ACCESS_KEY: undefined });
    __resetR2ClientForTests();
    await expect(new R2Adapter().stat("org/o1/receipts/d1.pdf")).rejects.toThrow(
      /R2_SECRET_ACCESS_KEY/,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("points the client at the account's R2 endpoint", async () => {
    send.mockResolvedValue({});
    await new R2Adapter().remove("org/o1/receipts/d1.pdf");
    const cmd = send.mock.calls[0][0];
    expect(cmd.kind).toBe("delete");
    // The mocked S3Client stores its config; `this` inside send is that instance.
    const client = send.mock.instances[0] as { config: Record<string, string> };
    expect(client.config.endpoint).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(client.config.region).toBe("auto");
  });
});
