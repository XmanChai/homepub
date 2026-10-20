<#
  一键发布：创建 GitHub 仓库、推送 main/tag、把 Gitea 仓库配成 GitHub 的只读拉取镜像。

  用法（在仓库根目录）：
    pwsh -File scripts/publish.ps1 -Owner xmanchai -Tag v0.1.0-rc1

  凭据：把 token 写进 %USERPROFILE%\.homepub\publish.env，不要提交到仓库：
    GITHUB_TOKEN=ghp_xxx        # classic: repo；fine-grained: Contents + Administration 写权限
    GITEA_TOKEN=xxx             # Gitea 设置 → 应用 → 生成令牌，勾选 repo
    GITHUB_OWNER=xmanchai       # 可选，也可用 -Owner 传

  脚本不会打印 token，也不会把 token 写进 git config。
#>
param(
  [string]$Owner = $env:GITHUB_OWNER,
  [string]$Repo = 'homepub',
  [string]$GiteaUrl = 'https://git.xmanchai.top',
  [string]$GiteaOwner = 'xmanchai',
  [string]$Tag = '',
  [switch]$SkipGitea
)

$ErrorActionPreference = 'Stop'

function Load-TokenFile {
  $file = Join-Path $env:USERPROFILE '.homepub\publish.env'
  if (-not (Test-Path $file)) { return $false }
  Get-Content $file | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$') {
      Set-Item -Path ('env:' + $Matches[1]) -Value $Matches[2]
    }
  }
  return $true
}

function Invoke-Api {
  param([string]$Method, [string]$Uri, [hashtable]$Headers, $Body)
  try {
    if ($Body -ne $null) {
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body ($Body | ConvertTo-Json -Depth 6) -ContentType 'application/json'
    }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
  } catch {
    return $null
  }
}

function Test-RemoteRepo {
  param([string]$Uri, [hashtable]$Headers)
  try {
    Invoke-RestMethod -Method Get -Uri $Uri -Headers $Headers | Out-Null
    return $true
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 404) { return $false }
    throw
  }
}

if (-not (Load-TokenFile)) {
  Write-Host 'WARN: %USERPROFILE%\.homepub\publish.env not found, relying on existing environment variables'
}
if (-not $Owner) { throw 'GitHub owner is required: pass -Owner or set GITHUB_OWNER' }
if (-not $env:GITHUB_TOKEN) { throw 'GITHUB_TOKEN is missing (put it in %USERPROFILE%\.homepub\publish.env)' }

$gitRoot = Split-Path -Parent $PSScriptRoot
Push-Location $gitRoot
try {
  if (-not (Test-Path '.git')) { throw "not a git repository: $gitRoot" }

  $ghHeaders = @{
    Authorization          = 'Bearer ' + $env:GITHUB_TOKEN
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'homepub-publish'
  }

  Write-Host "==> GitHub repo: $Owner/$Repo"
  if (Test-RemoteRepo -Uri "https://api.github.com/repos/$Owner/$Repo" -Headers $ghHeaders) {
    Write-Host '    already exists'
  } else {
    $created = Invoke-Api -Method Post -Uri 'https://api.github.com/user/repos' -Headers $ghHeaders -Body @{
      name        = $Repo
      description = 'Publish self-hosted services to the internet with one command: frp + nginx + ACME, generated and drift-checked.'
      homepage    = "https://$Owner.github.io/$Repo"
      private     = $false
      has_issues  = $true
      has_wiki    = $false
    }
    if (-not $created) { throw 'failed to create the GitHub repository (check token scopes)' }
    Write-Host '    created'
  }

  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $env:GITHUB_TOKEN))
  git remote remove origin 2>$null
  git remote add origin "https://github.com/$Owner/$Repo.git"

  Write-Host '==> push main'
  git -c http.extraHeader="AUTHORIZATION: Basic $b64" push origin main
  if ($LASTEXITCODE -ne 0) { throw 'push to GitHub failed' }

  if ($Tag) {
    $exists = git tag --list $Tag
    if (-not $exists) {
      git tag -a $Tag -m "homepub $Tag"
    }
    Write-Host "==> push tag $Tag"
    git -c http.extraHeader="AUTHORIZATION: Basic $b64" push origin $Tag
    if ($LASTEXITCODE -ne 0) { throw 'tag push failed' }
  }

  if (-not $SkipGitea) {
    if (-not $env:GITEA_TOKEN) { Write-Host 'WARN: GITEA_TOKEN missing, skip mirror setup'; return }
    $giteaHeaders = @{ Authorization = 'token ' + $env:GITEA_TOKEN; 'User-Agent' = 'homepub-publish' }
    $repoUri = "$GiteaUrl/api/v1/repos/$GiteaOwner/$Repo"
    Write-Host "==> Gitea mirror: $GiteaOwner/$Repo"
    if (Test-RemoteRepo -Uri $repoUri -Headers $giteaHeaders) {
      Write-Host '    repository already exists'
      $mirror = Invoke-Api -Method Patch -Uri "$repoUri" -Headers $giteaHeaders -Body @{ mirror_interval = '8h0m0s' }
      if ($mirror) { Write-Host '    mirror interval set to 8h' }
    } else {
      $migrated = Invoke-Api -Method Post -Uri "$GiteaUrl/api/v1/repos/migrate" -Headers $giteaHeaders -Body @{
        clone_addr      = "https://github.com/$Owner/$Repo.git"
        repo_name       = $Repo
        repo_owner      = $GiteaOwner
        mirror          = $true
        mirror_interval = '8h0m0s'
        private         = $false
        description     = 'Read-only mirror of the GitHub repository'
        service         = 'github'
      }
      if (-not $migrated) { throw 'failed to create the Gitea mirror (check token scope: repo)' }
      Write-Host '    created as pull mirror, interval 8h'
    }
  }

  Write-Host ''
  Write-Host 'done:'
  Write-Host "  GitHub: https://github.com/$Owner/$Repo"
  if (-not $SkipGitea) { Write-Host "  Gitea : $GiteaUrl/$GiteaOwner/$Repo" }
} finally {
  Pop-Location
}
