import {
  Archive,
  Download,
  FilePlus2,
  Folder,
  Inbox,
  Lightbulb,
  Mic2,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Upload
} from "lucide-react";
import type { Category } from "../lib/types";

interface SidebarProps {
  categories: Category[];
  selectedCategory: string;
  search: string;
  theme: "light" | "dark";
  installAvailable: boolean;
  onSelectCategory: (id: string) => void;
  onSearch: (value: string) => void;
  onNewNote: () => void;
  onVoiceNote: () => void;
  onNewCategory: () => void;
  onExport: () => void;
  onImport: () => void;
  onToggleTheme: () => void;
  onInstall: () => void;
}

function categoryIcon(id: string) {
  if (id === "all") return <Lightbulb size={17} />;
  if (id === "inbox") return <Inbox size={17} />;
  if (id === "archive") return <Archive size={17} />;
  return <Folder size={17} />;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">I</div>
        <div>
          <div className="brand-name">Idearium</div>
          <div className="brand-kicker">Arxiu personal d'idees</div>
        </div>
      </div>

      <div className="capture-grid">
        <button className="primary-button" onClick={props.onNewNote}>
          <FilePlus2 size={18} />
          Nova nota
        </button>
        <button className="icon-button capture-mic" onClick={props.onVoiceNote} title="Gravar nota de veu">
          <Mic2 size={19} />
        </button>
      </div>

      <label className="search-box">
        <Search size={17} />
        <input
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder="Cerca títols, text o etiquetes"
        />
      </label>

      <nav className="category-nav" aria-label="Categories">
        <button
          className={`category-row ${props.selectedCategory === "all" ? "active" : ""}`}
          onClick={() => props.onSelectCategory("all")}
        >
          <span className="category-icon">{categoryIcon("all")}</span>
          <span>Totes les notes</span>
        </button>

        {props.categories.map((category) => (
          <button
            key={category.id}
            className={`category-row ${props.selectedCategory === category.id ? "active" : ""}`}
            onClick={() => props.onSelectCategory(category.id)}
          >
            <span className="category-icon">{categoryIcon(category.id)}</span>
            <span className="category-dot" style={{ background: category.accent }} />
            <span>{category.name}</span>
          </button>
        ))}

        <button className="category-row subtle" onClick={props.onNewCategory}>
          <span className="category-icon"><Plus size={17} /></span>
          <span>Nova categoria</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <div className="utility-panel">
        {props.installAvailable && (
          <button className="utility-row" onClick={props.onInstall}>
            <Download size={16} />
            Instal·lar aplicació
          </button>
        )}
        <button className="utility-row" onClick={props.onExport}>
          <Download size={16} />
          Exportar còpia
        </button>
        <button className="utility-row" onClick={props.onImport}>
          <Upload size={16} />
          Importar còpia
        </button>
        <button className="utility-row" onClick={props.onToggleTheme}>
          {props.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          Tema {props.theme === "dark" ? "clar" : "fosc"}
        </button>
        <div className="local-only-note">
          <Settings2 size={15} />
          <span>Dades locals en aquest dispositiu</span>
        </div>
      </div>
    </aside>
  );
}
