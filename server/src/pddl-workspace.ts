import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DomainInfo,
  FileInfo,
  FileType,
  PddlLanguage,
  PddlWorkspace,
  ProblemInfo,
  SimpleDocumentPositionResolver,
} from "pddl-workspace";
import {
  TextDocuments,
  TextDocument,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";

function toFileType(direntType: number): FileType {
  if ((direntType & 1) === 1) return FileType.File;
  if ((direntType & 2) === 2) return FileType.Directory;
  return FileType.Unknown;
}

export class LspPddlWorkspace {
  readonly pddlWorkspace = new PddlWorkspace({
    epsilon: 0.001,
    fileLoader: {
      async readDirectory(uri: URI): Promise<[string, FileType][]> {
        const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
        return entries.map((entry) => [
          entry.name,
          entry.isDirectory() ? FileType.Directory : FileType.File,
        ]);
      },
      async readFile(uri: URI): Promise<Uint8Array> {
        return fs.readFile(uri.fsPath);
      },
    },
  });

  constructor(private readonly documents: TextDocuments<TextDocument>) {}

  async upsertAndParseDocument(document: TextDocument): Promise<FileInfo> {
    return this.pddlWorkspace.upsertAndParseFile(
      URI.parse(document.uri),
      PddlLanguage.PDDL,
      document.version,
      document.getText(),
      new SimpleDocumentPositionResolver(document.getText()),
    );
  }

  async upsertAndParseText(
    uri: string,
    text: string,
    version = 1,
  ): Promise<FileInfo> {
    return this.pddlWorkspace.upsertAndParseFile(
      URI.parse(uri),
      PddlLanguage.PDDL,
      version,
      text,
      new SimpleDocumentPositionResolver(text),
    );
  }

  async ensureParsed(uri: string): Promise<FileInfo | undefined> {
    const openDocument = this.documents.get(uri);
    if (openDocument) {
      return this.upsertAndParseDocument(openDocument);
    }

    const uriObject = URI.parse(uri);
    if (uriObject.scheme !== "file") {
      return this.getFileInfo(uri);
    }

    try {
      const text = await fs.readFile(uriObject.fsPath, "utf8");
      return this.upsertAndParseText(uri, text, 0);
    } catch {
      return this.getFileInfo(uri);
    }
  }

  getFileInfo<T extends FileInfo>(uri: string): T | undefined {
    return this.pddlWorkspace.getFileInfo<T>(URI.parse(uri));
  }

  async getTextDocument(uri: string): Promise<TextDocument> {
    const openDocument = this.documents.get(uri);
    if (openDocument) {
      return openDocument;
    }

    const uriObject = URI.parse(uri);
    const text = await fs.readFile(uriObject.fsPath, "utf8");
    return TextDocument.create(uri, "pddl", 0, text);
  }

  asDomain(fileInfo: FileInfo): DomainInfo | undefined {
    return this.pddlWorkspace.asDomain(fileInfo);
  }

  getProblemFiles(domainInfo: DomainInfo): ProblemInfo[] {
    return this.pddlWorkspace.getProblemFiles(domainInfo);
  }

  getDomainFileFor(problemInfo: ProblemInfo): DomainInfo | undefined {
    return this.pddlWorkspace.getDomainFileFor(problemInfo);
  }

  getRootPath(): string {
    return path.resolve(__dirname, "../../..");
  }
}
