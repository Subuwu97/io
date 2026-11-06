const IO_NAV_TRANSLATIONS = {
  es: {
    Home: "Inicio",
    Series: "Series",
    Movies: "Películas",
    Books: "Libros",
    "New & Popular": "Novedades y populares",
    "TV guide": "Guía de TV",
    Search: "Buscar",
    Notifications: "Notificaciones",
    "Account menu": "Menú de cuenta",
    "Account & preferences": "Cuenta y preferencias",
    "Email & connections": "Correo y conexiones",
    "Viewing profiles": "Perfiles",
    "Email & sign-in setup": "Correo e inicio de sesión",
    "Live channels": "Canales en directo",
    "Discussion reports": "Denuncias de comentarios",
    "My requests & reports": "Mis solicitudes e informes",
    "Library review queue": "Revisión de biblioteca",
    "Public profile & privacy": "Perfil público y privacidad",
    "Discover people": "Descubrir personas",
    Passkeys: "Claves de acceso",
    "Playback & subtitle preferences": "Reproducción y subtítulos",
    "Tailor recommendations": "Personalizar recomendaciones",
    "Your data & account": "Tus datos y cuenta",
    "TV devices & remote": "Dispositivos de TV y mando",
    "Personal tracker sync": "Sincronizar listas personales",
    "Notification categories": "Categorías de notificaciones",
    "Discord watch activity": "Actividad de reproducción en Discord",
    "Back to Browse": "Volver al catálogo",
    "My List": "Mi lista",
    Settings: "Configuración",
    "Watch History": "Historial",
    "Sign out": "Cerrar sesión",
  },
  fr: {
    Home: "Accueil",
    Series: "Séries",
    Movies: "Films",
    Books: "Livres",
    "New & Popular": "Nouveautés et tendances",
    "TV guide": "Guide TV",
    Search: "Rechercher",
    Notifications: "Notifications",
    "Account menu": "Menu du compte",
    "Account & preferences": "Compte et préférences",
    "Email & connections": "E-mail et connexions",
    "Viewing profiles": "Profils",
    "Email & sign-in setup": "E-mail et connexion",
    "Live channels": "Chaînes en direct",
    "Discussion reports": "Signalements de commentaires",
    "My requests & reports": "Mes demandes et signalements",
    "Library review queue": "Validation de la bibliothèque",
    "Public profile & privacy": "Profil public et confidentialité",
    "Discover people": "Découvrir des membres",
    Passkeys: "Clés d’accès",
    "Playback & subtitle preferences": "Lecture et sous-titres",
    "Tailor recommendations": "Personnaliser les recommandations",
    "Your data & account": "Vos données et votre compte",
    "TV devices & remote": "Téléviseurs et télécommande",
    "Personal tracker sync": "Synchronisation des listes",
    "Notification categories": "Catégories de notifications",
    "Discord watch activity": "Activité de lecture Discord",
    "Back to Browse": "Retour au catalogue",
    "My List": "Ma liste",
    Settings: "Paramètres",
    "Watch History": "Historique",
    "Sign out": "Se déconnecter",
  },
  ja: {
    Home: "ホーム",
    Series: "シリーズ",
    Movies: "映画",
    Books: "本",
    "New & Popular": "新着・人気",
    "TV guide": "テレビ番組表",
    Search: "検索",
    Notifications: "通知",
    "Account menu": "アカウントメニュー",
    "Account & preferences": "アカウントと設定",
    "Email & connections": "メールと連携",
    "Viewing profiles": "プロフィール",
    "Email & sign-in setup": "メール・ログイン設定",
    "Live channels": "ライブチャンネル",
    "Discussion reports": "コメントの報告",
    "My requests & reports": "リクエストと報告",
    "Library review queue": "ライブラリの審査",
    "Public profile & privacy": "公開プロフィールとプライバシー",
    "Discover people": "ユーザーを探す",
    Passkeys: "パスキー",
    "Playback & subtitle preferences": "再生と字幕の設定",
    "Tailor recommendations": "おすすめの調整",
    "Your data & account": "データとアカウント",
    "TV devices & remote": "テレビとリモコン",
    "Personal tracker sync": "個人リストの同期",
    "Notification categories": "通知カテゴリー",
    "Discord watch activity": "Discordの視聴アクティビティ",
    "Back to Browse": "一覧に戻る",
    "My List": "マイリスト",
    Settings: "設定",
    "Watch History": "視聴履歴",
    "Sign out": "ログアウト",
  },
};
for (const lang of ["es", "fr", "ja"])
  Object.assign(IO_NAV_TRANSLATIONS[lang], IO_UI_TRANSLATIONS[lang]);
(function () {
  const originals = new WeakMap(),
    textOriginals = new WeakMap(),
    attributeOriginals = new WeakMap();
  let scheduled = false;
  function translate() {
    scheduled = false;
    const lang = Store.activeProfile?.experience?.interfaceLanguage || "en",
      dictionary = IO_NAV_TRANSLATIONS[lang] || {};
    document.documentElement.lang = lang;
    function translated(text) {
      const prefix = (text.match(/^[‹←]\s*/) || [""])[0],
        source = text.slice(prefix.length);
      return prefix + (dictionary[source] || source);
    }
    const targets = document.querySelectorAll(
      ".io-settings-content label,.io-settings-content button,.io-settings-content h2,.io-settings-content h3,.io-settings-content>section>p,.io-settings-content option,.io-advanced-page label,.io-advanced-page button,.io-advanced-page option,.io-advanced-page h1,.io-novel>header label,.io-novel>header button,.io-novel>header summary,.io-novel>header option,.io-novel>footer button,#ioDiscussionForm button,#ioDiscussionForm label",
    );
    for (const target of targets) {
      if (
        target.closest(
          '#ioRestoreSource,#ioRestoreTarget,select[name="profileId"],.io-comment-editor',
        )
      )
        continue;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (
          node.parentElement.closest(
            '#ioRestoreSource,#ioRestoreTarget,select[name="profileId"]',
          )
        )
          continue;
        const text = node.nodeValue,
          old = textOriginals.get(node),
          source = old && old.last === text ? old.source : text,
          trimmed = source.trim(),
          value = translated(trimmed),
          next = value === trimmed ? source : source.replace(trimmed, value);
        if (text !== next) node.nodeValue = next;
        textOriginals.set(node, { source, last: next });
      }
    }
    for (const target of document.querySelectorAll(
      'input[placeholder],textarea[placeholder],button[aria-label],[role="toolbar"][aria-label],[role="textbox"][aria-label]',
    )) {
      let state = attributeOriginals.get(target) || {};
      for (const attribute of ["placeholder", "aria-label"]) {
        if (!target.hasAttribute(attribute)) continue;
        const text = target.getAttribute(attribute),
          old = state[attribute],
          source = old && old.last === text ? old.source : text,
          value = translated(source);
        if (text !== value) target.setAttribute(attribute, value);
        state[attribute] = { source, last: value };
      }
      attributeOriginals.set(target, state);
    }

    for (const el of document.querySelectorAll(
      ".navbar a,.io-settings-nav a,.io-settings-page>h1,.io-footer a",
    )) {
      if (el.children.length) continue;
      const old = originals.get(el),
        text = el.textContent,
        source = old && old.last === text ? old.source : text,
        translated = dictionary[source] || source;
      if (text !== translated) el.textContent = translated;
      originals.set(el, { source, last: translated });
    }
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(translate);
    }
  }).observe(document.getElementById("app"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.ioTranslateNavigation = translate;
})();
