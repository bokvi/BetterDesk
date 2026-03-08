# Docker Image Publishing Plan

Publish pre-built Docker images from the bokvi/BetterDesk fork to GitHub Container Registry (GHCR).

## Images to publish

| Image | Dockerfile | Description |
|-------|-----------|-------------|
| `ghcr.io/bokvi/betterdesk:latest` | `Dockerfile` | Full stack (Go server + Node.js console + supervisord) |
| `ghcr.io/bokvi/betterdesk-server:latest` | `Dockerfile.server` | Go server only (signal + relay + API) |
| `ghcr.io/bokvi/betterdesk-console:latest` | `Dockerfile.console` | Node.js web console only |

## Tag strategy

- `latest` — built from `main` branch on every push
- `vX.Y.Z` — built from git tags (e.g., `v2.4.0`)
- `sha-<short>` — commit SHA for traceability

## GitHub Actions workflow

Create `.github/workflows/docker-publish.yml`:

```yaml
name: Build and Publish Docker Images

on:
  push:
    branches: [main]
    paths:
      - 'betterdesk-server/**'
      - 'web-nodejs/**'
      - 'docker/**'
      - 'Dockerfile*'
      - '.github/workflows/docker-publish.yml'
    tags:
      - 'v*'
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/bokvi

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    strategy:
      matrix:
        include:
          - image: betterdesk
            dockerfile: Dockerfile
          - image: betterdesk-server
            dockerfile: Dockerfile.server
          - image: betterdesk-console
            dockerfile: Dockerfile.console

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Set up QEMU (for multi-arch)
        uses: docker/setup-qemu-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_PREFIX }}/${{ matrix.image }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Known issues to fix before first build

### 1. Go 1.25 doesn't exist yet

The Dockerfiles use `golang:1.25-alpine` as build base. Go 1.25 is not released as of March 2026. Fix:

```dockerfile
# Change in Dockerfile and Dockerfile.server:
- FROM golang:1.25-alpine AS go-builder
+ FROM golang:1.24-alpine AS go-builder
```

Verify the code compiles with Go 1.24 first. If it uses 1.25-specific features, check `betterdesk-server/go.mod` for the `go` directive.

### 2. ARM64 cross-compilation with CGO

The server build uses `CGO_ENABLED=1` for SQLite. Multi-arch builds via QEMU will handle this automatically with `docker buildx`, but builds will be slow (~15-20 min for arm64 emulation). Alternative: use a cross-compilation stage or accept amd64-only initially.

### 3. Package visibility

After the first push, GHCR packages default to **private**. Go to `github.com/orgs/bokvi/packages` and set visibility to **public** for each package, or add to the workflow:

```yaml
      - name: Make package public
        run: |
          gh api orgs/bokvi/packages/container/${{ matrix.image }} \
            -X PATCH -f visibility=public || true
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Steps to implement

1. **Verify Go version**: Check `betterdesk-server/go.mod` and fix `golang:` base image version if needed
2. **Create workflow**: Add `.github/workflows/docker-publish.yml` with the content above
3. **Test locally first**: `docker build -t betterdesk:test .` to confirm the Dockerfile works
4. **Push to fork**: Commit and push — workflow triggers automatically
5. **Fix any build failures**: Check Actions tab, iterate
6. **Set package visibility**: Make GHCR packages public once first build succeeds
7. **Update k8s manifests**: Reference `ghcr.io/bokvi/betterdesk:latest` in `k8s/betterdesk/deployment.yml`

## Usage in k8s after publishing

```yaml
# Single-container deployment (recommended)
containers:
  - name: betterdesk
    image: ghcr.io/bokvi/betterdesk:latest
    ports:
      - containerPort: 21115
        hostPort: 21115
        protocol: TCP
      - containerPort: 21116
        hostPort: 21116
        protocol: TCP
      - containerPort: 21116
        hostPort: 21116
        protocol: UDP
      - containerPort: 21117
        hostPort: 21117
        protocol: TCP
      - containerPort: 21118
        hostPort: 21118
        protocol: TCP
      - containerPort: 21119
        hostPort: 21119
        protocol: TCP
      - containerPort: 5000    # web console (behind Traefik)
      - containerPort: 21114   # API
      - containerPort: 21121   # client API
    volumeMounts:
      - name: data
        mountPath: /opt/rustdesk
      - name: console-data
        mountPath: /app/data
```
