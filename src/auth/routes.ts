import type { Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errors.js";
import { authenticate, registerAccount, registerSchema, requireAuth, signToken } from "./auth.js";

export const authRouter: Router = createRouter();

authRouter.post("/register", async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    if (input.role !== "member") {
      throw new ApiError(403, "Only member accounts may self-register", "SELF_ROLE_ASSIGNMENT_DENIED");
    }
    const account = await registerAccount(input);
    res.status(201).json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(128),
    }).parse(req.body);
    const user = await authenticate(input.email, input.password);
    res.status(200).json({
      success: true,
      data: { accessToken: signToken(user), expiresIn: "8h", user },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ success: true, data: req.auth });
});
