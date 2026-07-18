import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/ipc";
import type { RemoteFileEntry } from "../../types";

interface TreeDirectory {
  name: string;
  path: string;
}

interface RemoteDirectoryTreeProps {
  sessionId: string;
  currentPath: string;
  loadedPath: string | null;
  loadedEntries: RemoteFileEntry[];
  onNavigate: (path: string) => void;
  onOpenContextMenu: (path: string, x: number, y: number) => void;
  onError: (message: string) => void;
}

function directoryAncestors(path: string) {
  const parts = path.split("/").filter(Boolean);
  return ["/", ...parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`)];
}

function directCurrentChild(parentPath: string, currentPath: string): TreeDirectory | null {
  if (parentPath === currentPath) return null;
  const prefix = parentPath === "/" ? "/" : `${parentPath}/`;
  if (!currentPath.startsWith(prefix)) return null;
  const name = currentPath.slice(prefix.length).split("/")[0];
  if (!name) return null;
  return { name, path: parentPath === "/" ? `/${name}` : `${parentPath}/${name}` };
}

function directoriesFromEntries(entries: RemoteFileEntry[]) {
  return entries
    .filter((entry) => entry.kind === "directory")
    .map((entry) => ({ name: entry.name, path: entry.path }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function RemoteDirectoryTree({ sessionId, currentPath, loadedPath, loadedEntries, onNavigate, onOpenContextMenu, onError }: RemoteDirectoryTreeProps) {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, TreeDirectory[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const loadedPathsRef = useRef<Set<string>>(new Set());
  const loadingPathsRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);

  const loadChildren = useCallback(async (path: string, reportError = false) => {
    if (loadedPathsRef.current.has(path) || loadingPathsRef.current.has(path)) return;
    const generation = generationRef.current;
    loadingPathsRef.current.add(path);
    setLoading((current) => new Set(current).add(path));
    try {
      const entries = await api.remoteFiles(sessionId, path);
      if (generationRef.current !== generation) return;
      loadedPathsRef.current.add(path);
      setChildrenByPath((current) => ({ ...current, [path]: directoriesFromEntries(entries) }));
    } catch (error) {
      if (generationRef.current === generation && reportError) onError(String(error));
    } finally {
      if (generationRef.current === generation) {
        loadingPathsRef.current.delete(path);
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    }
  }, [onError, sessionId]);

  useEffect(() => {
    generationRef.current += 1;
    loadedPathsRef.current.clear();
    loadingPathsRef.current.clear();
    setChildrenByPath({});
    setExpanded(new Set(["/"]));
    setLoading(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (!loadedPath) return;
    loadedPathsRef.current.add(loadedPath);
    setChildrenByPath((current) => ({ ...current, [loadedPath]: directoriesFromEntries(loadedEntries) }));
  }, [loadedEntries, loadedPath]);

  useEffect(() => {
    const ancestors = directoryAncestors(currentPath);
    setExpanded((current) => new Set([...current, ...ancestors]));
    ancestors.slice(0, -1).forEach((path) => { void loadChildren(path); });
  }, [currentPath, loadChildren]);

  const toggle = (path: string) => {
    const isExpanded = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded) void loadChildren(path, true);
  };

  const renderNode = (directory: TreeDirectory, level: number): ReactNode => {
    const storedChildren = childrenByPath[directory.path] ?? [];
    const currentChild = directCurrentChild(directory.path, currentPath);
    const children = currentChild && !storedChildren.some((child) => child.path === currentChild.path)
      ? [...storedChildren, currentChild].sort((left, right) => left.name.localeCompare(right.name))
      : storedChildren;
    const isExpanded = expanded.has(directory.path);
    const canExpand = !loadedPathsRef.current.has(directory.path) || children.length > 0;
    return (
      <div className="remote-tree-branch" key={directory.path}>
        <div className={`remote-tree-row ${directory.path === currentPath ? "active" : ""}`} style={{ paddingLeft: `${level * 14 + 3}px` }}>
          {canExpand ? <button className="remote-tree-toggle" type="button" aria-label={`${isExpanded ? "收起" : "展开"} ${directory.name}`} title={isExpanded ? "收起" : "展开"} onClick={() => toggle(directory.path)}>{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="remote-tree-toggle-spacer" />}
          <button className="remote-tree-directory" type="button" title={directory.path} onClick={() => onNavigate(directory.path)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onOpenContextMenu(directory.path, event.clientX, event.clientY); }}><Folder size={14} /><span>{directory.name}</span></button>
        </div>
        {isExpanded && <div>{children.map((child) => renderNode(child, level + 1))}{loading.has(directory.path) && <div className="remote-tree-loading" style={{ paddingLeft: `${(level + 1) * 14 + 25}px` }}>读取中...</div>}</div>}
      </div>
    );
  };

  return (
    <div className="file-tree" onContextMenu={(event) => { event.preventDefault(); onOpenContextMenu(currentPath, event.clientX, event.clientY); }}>
      {renderNode({ name: "/", path: "/" }, 0)}
    </div>
  );
}
