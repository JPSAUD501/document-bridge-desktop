import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import {
  APP_NAME,
  APP_VERSION,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASE_ASSET_NAME,
  isCompiledBinary,
  isUpdaterConfigured,
} from "../app-version";
import type { BootstrapResult } from "../types";
import { summarizeError } from "../lib/utils";
import { BootstrapLogger } from "./bootstrap-logger";
import { downloadAsset } from "./asset-downloader";
import { parseSha256Sums, validateFileChecksum } from "./checksum-validator";
import { scheduleExecutableSwap } from "./exe-installer";
import { fetchStableReleases, selectLatestStableRelease } from "./github-releases-client";

export async function runBootstrap(): Promise<BootstrapResult> {
  const logger = new BootstrapLogger();
  const notes = [`Versao do app: ${APP_VERSION}`];

  if (!isCompiledBinary()) {
    const note =
      "Atualizacao automatica ignorada porque o app esta rodando em modo de desenvolvimento Node.";
    await logger.log(note);
    notes.push(note);
    return { mode: "continue", notes };
  }

  if (!isUpdaterConfigured()) {
    const note = "Atualizacao automatica ignorada porque a configuracao de releases do GitHub esta incompleta.";
    await logger.log(note);
    notes.push(note);
    return { mode: "continue", notes };
  }

  try {
    await logger.log(`Consultando releases de ${GITHUB_OWNER}/${GITHUB_REPO}.`);
    const releases = await fetchStableReleases(
      GITHUB_OWNER,
      GITHUB_REPO,
      process.env.GITHUB_TOKEN,
    );
    const latestRelease = selectLatestStableRelease(releases);
    if (!latestRelease) {
      const note = "Nenhuma release estavel foi encontrada no GitHub.";
      await logger.log(note);
      notes.push(note);
      return { mode: "continue", notes };
    }

    await logger.log(`Versao local ${APP_VERSION}, versao remota ${latestRelease.tag_name}.`);
    notes.push(`Versao remota detectada: ${latestRelease.tag_name}`);

    if (!semver.valid(APP_VERSION) || semver.gte(APP_VERSION, latestRelease.tag_name)) {
      const note = "O executavel local ja esta atualizado.";
      await logger.log(note);
      notes.push(note);
      return { mode: "continue", notes };
    }

    const exeAsset = latestRelease.assets.find((asset) => asset.name === RELEASE_ASSET_NAME);
    const checksumAsset = latestRelease.assets.find((asset) => /sha256sums/i.test(asset.name));

    if (!exeAsset || !checksumAsset) {
      const note = "Os assets da release estao incompletos; mantendo a versao local.";
      await logger.log(note);
      notes.push(note);
      return { mode: "continue", notes };
    }

    await logger.log(`Usando o asset ${exeAsset.browser_download_url}.`);
    const stagingDir = path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      APP_NAME,
      "staging",
      latestRelease.tag_name,
    );
    await fs.mkdir(stagingDir, { recursive: true });

    const stagedExePath = path.join(stagingDir, RELEASE_ASSET_NAME);
    const stagedChecksumPath = path.join(stagingDir, checksumAsset.name);
    await downloadAsset(exeAsset.browser_download_url, stagedExePath, process.env.GITHUB_TOKEN);
    await logger.log("Executavel baixado.");
    await downloadAsset(checksumAsset.browser_download_url, stagedChecksumPath, process.env.GITHUB_TOKEN);
    await logger.log("Arquivo de checksum baixado.");

    const checksumContents = await fs.readFile(stagedChecksumPath, "utf8");
    const sums = parseSha256Sums(checksumContents);
    const expectedHash = sums.get(RELEASE_ASSET_NAME);
    if (!expectedHash) {
      throw new Error(`O arquivo SHA256SUMS.txt nao contem ${RELEASE_ASSET_NAME}`);
    }

    const valid = await validateFileChecksum(stagedExePath, expectedHash);
    await logger.log(`Resultado da validacao do checksum: ${valid}.`);
    if (!valid) {
      throw new Error("O executavel baixado falhou na validacao SHA-256.");
    }

    await scheduleExecutableSwap({
      currentExePath: process.execPath,
      stagedExePath,
      logPath: logger.logPath,
    });
    await logger.log("Troca automatica de versao agendada.");
    return {
      mode: "handoff",
      notes: [...notes, "A nova versao sera iniciada automaticamente em seguida."],
    };
  } catch (error) {
    const note = `A atualizacao falhou e a versao local sera mantida: ${summarizeError(error)}`;
    await logger.log(note);
    notes.push(note);
    return { mode: "continue", notes };
  }
}
