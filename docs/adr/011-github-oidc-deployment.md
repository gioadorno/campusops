# ADR 011: GitHub OIDC deployment

- Status: Accepted
- Date: 2026-08-13

Manual dev deployment uses GitHub OIDC short-lived credentials and the protected `dev` environment. Trust is constrained to `repo:gioadorno/campusops:environment:dev`. The enumerated deployment policy and runtime policy are separate; long-lived AWS keys are prohibited.
