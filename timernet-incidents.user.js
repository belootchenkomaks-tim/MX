// ==UserScript==
// @name         CabTools
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Добавляет кнопки и шаблоны на billing + авто-заполнение / фоновое создание ТТ на Forest
// @author       MX
// @match        https://billing.timernet.ru/*
// @match        https://forest.timernet.ru/service-desk/tt/create*
// @match        https://forest.timernet.ru/technical-support/network/index*
// @icon         https://billing.timernet.ru/favicon.ico
// @updateURL    https://raw.githubusercontent.com/belootchenkomaks-tim/MX/main/timernet-incidents.user.js
// @downloadURL  https://raw.githubusercontent.com/belootchenkomaks-tim/MX/main/timernet-incidents.user.js
// @supportURL   https://github.com/belootchenkomaks-tim/MX
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      forest.timernet.ru
// @connect      billing.timernet.ru
// ==/UserScript==

(function() {
    'use strict';

    // ── Определяем где запущены ──────────────────────────────────
    var isForest = window.location.hostname === 'forest.timernet.ru';

    if (isForest) {
        console.log('[TM] === ЗАПУЩЕН на forest: ' + window.location.href + ' ===');

        // ═════════════════════════════════════════════════════════
        //  РЕЖИМ FOREST — авто-заполнение формы создания ТТ
        // ═════════════════════════════════════════════════════════

        // Функция заполнения поля договора (select2) + всех client-полей
        function fillForestContract(contractNum) {
            if (!contractNum) return;

            // Читаем полные данные клиента
            var clientDataStr = GM_getValue('tm_forest_client_data');
            var clientData = null;
            try { clientData = JSON.parse(clientDataStr); } catch(e) {}
            var vgId = clientData ? String(clientData.vg_id || clientData.id) : contractNum;

            // ── Заполняем select2 ────────────────────────────────
            var select = document.getElementById('bg-dog_num');
            if (!select) { console.log('[TM] Поле bg-dog_num не найдено'); return; }

            var $ = (typeof jQuery !== 'undefined') ? jQuery : null;
            var $select = $ ? $(select) : null;
            var rendered = document.getElementById('select2-bg-dog_num-container');

            // Удаляем старый option если был, создаём новый
            var oldOpt = select.querySelector('option[value="' + vgId + '"]');
            if (oldOpt) oldOpt.remove();
            var opt = document.createElement('option');
            opt.value = vgId;
            opt.text = contractNum;
            opt.selected = true;
            select.appendChild(opt);

            if ($select) $select.val(vgId);
            else select.value = vgId;

            if (rendered) {
                rendered.textContent = contractNum;
                rendered.classList.remove('select2-selection__placeholder');
            }

            try {
                if ($select && $select.data('select2')) $select.trigger('change.select2');
                else if ($select) $select.trigger('change');
                else select.dispatchEvent(new Event('change', { bubbles: true }));
            } catch(e) {}

            // ── Заполняем скрытые поля и client-summary ──────────
            if (clientData) {
                // Hidden input
                var vgInput = document.getElementById('ttmodel-vg_id');
                if (vgInput) {
                    vgInput.value = clientData.vg_id || vgId;
                    vgInput.setAttribute('data-dognum', contractNum);
                    vgInput.dispatchEvent(new Event('input', { bubbles: true }));
                    vgInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Client summary fields
                var fields = {
                    'client-dog_num': contractNum,
                    'client-name': (clientData.user_name || ''),
                    'client-addr': (clientData.addresses || ''),
                    'client-login': (clientData.login || ''),
                    'client-tar_name': (clientData.tar_name || ''),
                    'client-balance': (clientData.balance !== undefined ? String(clientData.balance) : ''),
                    'client-blocked': (clientData.blocked == 1 ? 'заблокирован' : 'уч. запись активна'),
                    'client-ug_name': (clientData.agent_name || ''),
                    'client-phone_orig': (clientData.phone || '+79034604892'),
                    'client-ac_descr': (clientData.ac_descr || ''),
                    'client-vg_descr': (clientData.vg_descr || '')
                };
                for (var id in fields) {
                    var el = document.getElementById(id);
                    if (el) {
                        el.textContent = fields[id];
                    }
                }

                // Показываем секцию client-summary (если скрыта)
                var summary = document.getElementById('client-summary');
                if (summary) {
                    var card = summary.closest('.card, .card-body, div');
                    if (card) {
                        card.classList.remove('d-none');
                        card.style.display = '';
                    }
                }

                console.log('[TM] ✅📋 client-summary заполнен: ' + contractNum + ' / ' + (clientData.user_name || ''));
            }

            console.log('[TM] ✅📄 Договор #' + contractNum + ' (vg_id=' + vgId + ') установлен');
        }

        setTimeout(function() {
            var msg = GM_getValue('tm_forest_msg');
            var sol = GM_getValue('tm_forest_sol');
            var state = GM_getValue('tm_forest_state');
            var dogNum = GM_getValue('tm_forest_dog_num');
            var ts = GM_getValue('tm_forest_ts');
            var dogTs = GM_getValue('tm_forest_dog_ts');
            var intent = GM_getValue('tm_forest_intent');

            // ── ПРОВЕРКА НАМЕРЕНИЯ: данные применяем только если
            //    кнопка "Создать ТТ" была нажата не более 15 сек назад ──
            if (!intent || Date.now() - parseInt(intent) > 15000) {
                console.log('[TM] Нет свежего намерения от биллинга — очищаю все данные');
                GM_deleteValue('tm_forest_msg');
                GM_deleteValue('tm_forest_sol');
                GM_deleteValue('tm_forest_state');
                GM_deleteValue('tm_forest_ts');
                GM_deleteValue('tm_forest_dog_num');
                GM_deleteValue('tm_forest_dog_ts');
                GM_deleteValue('tm_forest_client_data');
                GM_deleteValue('tm_forest_intent');
                return;
            }

            if (!msg && !sol && !dogNum) {
                console.log('[TM] Нет данных от биллинга');
                return;
            }

            // Проверяем свежесть (не старше 60 секунд)
            if (ts && Date.now() - parseInt(ts) > 60000) {
                console.log('[TM] Данные устарели');
                GM_deleteValue('tm_forest_msg');
                GM_deleteValue('tm_forest_sol');
                GM_deleteValue('tm_forest_state');
                GM_deleteValue('tm_forest_ts');
                // Договор чистим отдельно,т.к. у него свой ts
            }
            if (dogTs && Date.now() - parseInt(dogTs) > 120000) {
                console.log('[TM] Данные договора устарели');
                GM_deleteValue('tm_forest_dog_num');
                GM_deleteValue('tm_forest_dog_ts');
                dogNum = null;
            }

            // Ждём пока появится поле описания
            var _waitFieldCount = 0;
            var waitField = setInterval(function() {
                var descField = document.getElementById('ttmodel-message');
                if (!descField) {
                    _waitFieldCount++;
                    if (_waitFieldCount > 100) { clearInterval(waitField); console.log('[TM] ⏱ Поле ttmodel-message не появилось (таймаут)'); return; }
                    return;
                }
                clearInterval(waitField);

                // Заполняем "Описание проблемы" (обрезаем до maxlength + ...)
                if (msg) {
                    var maxLen = descField.maxLength || descField.getAttribute('maxlength');
                    if (maxLen > 0 && msg.length > maxLen) {
                        msg = msg.substring(0, maxLen - 3) + '...';
                    }
                    descField.removeAttribute('maxlength');
                    descField.value = msg;
                    descField.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // Заполняем "Решение" (обрезаем до maxlength + ...)
                var solField = document.getElementById('ttmodel-message_solution');
                if (sol && solField) {
                    var solContainer = solField.closest('.form-group');
                    if (solContainer) solContainer.classList.remove('d-none');
                    var maxLen = solField.maxLength || solField.getAttribute('maxlength');
                    if (maxLen > 0 && sol.length > maxLen) {
                        sol = sol.substring(0, maxLen - 3) + '...';
                    }
                    solField.removeAttribute('maxlength');
                    solField.value = sol;
                    solField.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // Меняем "Источник" на "Запрос из ЛК"
                var sourceSelect = document.getElementById('ttmodel-source');
                if (sourceSelect) {
                    sourceSelect.value = '0';
                    sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Отмечаем "Решен"
                var stateCb = document.getElementById('ttmodel-state');
                if (stateCb && state === '1') {
                    stateCb.checked = true;
                    stateCb.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Заполняем договор (select2)
                if (dogNum) {
                    fillForestContract(dogNum);
                }

                // ── НАБЛЮДАТЕЛЬ: защита select2 от переинициализации страницей ──
                if (dogNum) {
                    var selectEl = document.getElementById('bg-dog_num');
                    var renderedEl = document.getElementById('select2-bg-dog_num-container');
                    var _restoring = false;
                    console.log('[TM] 🔬 Наблюдатель select2 активирован (15 сек)');

                    function _reapplyContract() {
                        if (_restoring || !selectEl || !dogNum) return;
                        var curRendered = renderedEl ? renderedEl.textContent.trim() : '';
                        // Если контейнер показывает не наш договор и не "(нет)" — значит сбросили
                        if (curRendered && curRendered !== dogNum && curRendered.indexOf(dogNum) === -1) {
                            console.log('[TM] ⚠️ select2 сброшен ("' + curRendered + '"), переустанавливаю "' + dogNum + '"');
                            _restoring = true;
                            fillForestContract(dogNum);
                            _restoring = false;
                        }
                    }

                    if (renderedEl) {
                        var mo = new MutationObserver(function() { _reapplyContract(); });
                        mo.observe(renderedEl, { childList: true, subtree: true, characterData: true });

                        // Страховочный polling (на случай если render-контейнер заменён целиком)
                        var safetyTimer = setInterval(_reapplyContract, 500);

                        setTimeout(function() {
                            mo.disconnect();
                            clearInterval(safetyTimer);
                            console.log('[TM] 🔬 Наблюдатель select2 отключён');
                        }, 15000);
                    } else {
                        console.log('[TM] ⚠️ select2-container не найден — использую polling');
                        var monCount = 0;
                        var monTimer = setInterval(function() {
                            monCount++;
                            renderedEl = document.getElementById('select2-bg-dog_num-container');
                            _reapplyContract();
                            if (monCount >= 30) {
                                clearInterval(monTimer);
                                console.log('[TM] 🔬 Polling select2 завершён');
                            }
                        }, 500);
                    }
                }

                console.log('[TM] ✅ Форма Forest заполнена из биллинга');

                // ═════════════════════════════════════════════════════
                //  АВТО-САБМИТ (для фонового создания ТТ через iframe)
                // Уведомление
                var hint = document.createElement('div');
                hint.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 99999; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 8px; padding: 12px 16px; font-size: 14px; color: #155724; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: Arial, sans-serif; max-width: 420px;';
                hint.innerHTML = '✅ Данные из биллинга подставлены.';
                if (dogNum) {
                    hint.innerHTML += '<br>📄 Договор: <b>' + dogNum.replace(/[<>"']/g, '') + '</b>';
                }
                hint.innerHTML += '<br>Проверьте и нажмите <b>Сохранить</b>.';
                document.body.appendChild(hint);
                setTimeout(function() { hint.remove(); }, 10000);

                // Очищаем данные
                GM_deleteValue('tm_forest_msg');
                GM_deleteValue('tm_forest_sol');
                GM_deleteValue('tm_forest_state');
                GM_deleteValue('tm_forest_ts');
                GM_deleteValue('tm_forest_dog_num');
                GM_deleteValue('tm_forest_dog_ts');
                GM_deleteValue('tm_forest_client_data');
                GM_deleteValue('tm_forest_intent');
            }, 300);
        }, 500);

        // ═════════════════════════════════════════════════════════
        //  РЕЖИМ FOREST — страница PON-парсера
        // ═════════════════════════════════════════════════════════
        if (window.location.href.indexOf('tab=pon-parser') !== -1) {
            // Читаем номер договора из GM_setValue (передан с биллинга)
            var dogNum = GM_getValue('tm_forest_parser_dog');
            if (dogNum) {
                console.log('[TM] Парсер: страница поиска, договор #' + dogNum);
                // Ждём появления поля dognum (страница может грузиться долго в фоне)
                var _waitReadyCount = 0;
                var _waitReady = setInterval(function() {
                    var input = document.getElementById('ponparsersearch-dognum')
                        || document.querySelector('input[name="PonParserSearch[dognum]"]');
                    if (input) {
                        clearInterval(_waitReady);
                        console.log('[TM] Парсер: поле dognum появилось, стартую...');
                        fillAndSearch(dogNum);
                    } else {
                        _waitReadyCount++;
                        if (_waitReadyCount > 60) {
                            clearInterval(_waitReady);
                            console.log('[TM] ⏱ Поле dognum не появилось (таймаут)');
                        }
                    }
                }, 200);
            }
        }

        // ─── Полный цикл поиска и диагностики ─────────────────────────
        function fillAndSearch(dogNum) {
            // Шаг 1: Вставить номер в поле поиска
            var searchInput = document.getElementById('ponparsersearch-dognum')
                || document.querySelector('input[name="PonParserSearch[dognum]"]');
            if (!searchInput) {
                console.log('[TM] Парсер: поле dognum не найдено');
                return;
            }
            searchInput.value = dogNum;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[TM] Парсер: номер вставлен, ищу кнопку поиска...');

            // Шаг 2: Найти кнопку поиска/фильтра и нажать
            setTimeout(function() {
                var searchBtn = document.querySelector('button[type="submit"], .btn-primary, .btn-search, [title*="Поиск"], [title*="Найти"]');
                if (searchBtn) {
                    console.log('[TM] Парсер: нажимаю поиск...');
                    searchBtn.click();
                } else {
                    // Enter
                    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                    console.log('[TM] Парсер: отправляю Enter');
                }
                
                // Шаг 3: Ждать появления кнопки "Диагностика"
                waitForDiagButton(dogNum);
            }, 300);
        }

        function waitForDiagButton(dogNum) {
            var diagCheck = 0;
            var diagTimer = setInterval(function() {
                diagCheck++;
                var diagBtn = document.querySelector('[title="Диагностика"], [id^="diag_"], .btn-outline-secondary[href*="diag"]');
                if (diagBtn) {
                    clearInterval(diagTimer);
                    console.log('[TM] Парсер: кнопка диагностики найдена, нажимаю...');
                    diagBtn.click();
                    // Шаг 4: Ждать модалку и захватить содержимое
                    setTimeout(function() { captureModal(dogNum); }, 500);
                } else if (diagCheck > 30) {
                    clearInterval(diagTimer);
                    console.log('[TM] Парсер: кнопка диагностики не появилась — нет данных');
                    // Сообщаем биллингу что данных нет
                    GM_setValue('tm_parser_result', 'Нет данных по договору ' + dogNum + ' в PON-парсере.');
                    GM_setValue('tm_parser_ready', '1');
                    GM_deleteValue('tm_forest_parser_dog');
                    showForestNotice(dogNum);
                    setTimeout(function() { window.close(); }, 2000);
                }
            }, 500);
        }

        var _captureModalCount = 0;
        function captureModal(dogNum) {
            _captureModalCount++;
            if (_captureModalCount > 30) {
                console.log('[TM] Парсер: модалка не появилась (таймаут)');
                GM_setValue('tm_parser_result', 'Нет данных (модалка не открылась)');
                GM_setValue('tm_parser_ready', '1');
                GM_deleteValue('tm_forest_parser_dog');
                showForestNotice(dogNum);
                return;
            }
            var modalBody = document.querySelector('.modal-body .table-bordered, .modal-body table.table');
            if (modalBody) {
                // Сохраняем содержимое таблицы как текст
                var rows = modalBody.querySelectorAll('tr');
                var text = '';
                for (var r = 0; r < rows.length; r++) {
                    var cells = rows[r].querySelectorAll('td');
                    if (cells.length >= 2) {
                        var label = cells[0].textContent.trim();
                        var value = cells[1].textContent.trim();
                        text += label + '\t' + value + '\n';
                    } else if (cells.length === 1) {
                        text += cells[0].textContent.trim() + '\n';
                    }
                }
                console.log('[TM] Парсер: данные захвачены');
                GM_setValue('tm_parser_result', text);
                GM_setValue('tm_parser_ready', '1');
                GM_deleteValue('tm_forest_parser_dog');
                // Закрываем модалку
                var closeBtn = document.querySelector('.modal-header .close, .modal-header button[data-dismiss="modal"], .modal .btn-close');
                if (closeBtn) closeBtn.click();
                showForestNotice(dogNum);
                // Пытаемся закрыть вкладку сразу (работает в фоне)
                setTimeout(function() { window.close(); }, 100);
            } else {
                console.log('[TM] Парсер: модалка не найдена, жду...');
                setTimeout(function() { captureModal(dogNum); }, 300);
            }
        }

        function showForestNotice(dogNum) {
            var notice = document.createElement('div');
            notice.style.cssText = 'position: fixed; bottom: 80px; right: 20px; z-index: 99999; background: #0d6efd; color: #fff; border-radius: 12px; padding: 16px 20px; font-size: 15px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-family: Arial, sans-serif; max-width: 360px;';
            notice.innerHTML = '✅ Результат отправлен в биллинг<br><small>Вкладка закроется автоматически</small>';
            document.body.appendChild(notice);
            setTimeout(function() { notice.remove(); }, 8000);
        }

        // ═════════════════════════════════════════════════════════════
        //  ПЕРЕХВАТ XHR — логируем POST-запросы на создание ТТ
        // ═════════════════════════════════════════════════════════════
        if (window.location.href.indexOf('/service-desk/tt/create') !== -1) {
            console.log('[TM] 🌳🔧 Перехватываю XHR на tt/create...');
            var _origOpen = XMLHttpRequest.prototype.open;
            var _origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url) {
                this._tm_method = method;
                this._tm_url = (typeof url === 'string') ? url : (url + '');
                return _origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function(body) {
                var xhr = this;
                var url = xhr._tm_url || '';
                if (xhr._tm_method === 'POST' && url.indexOf('tt/create') !== -1) {
                    console.log('[TM] 🌳🔧=== ПЕРЕХВАЧЕН XHR POST ===');
                    console.log('[TM] 🌳🔧 URL:', url);
                    console.log('[TM] 🌳🔧 body type:', typeof body, '| body empty?', !body);
                    if (body && typeof body === 'string') {
                        console.log('[TM] 🌳🔧 BODY строка (' + body.length + '):', body.substring(0, 2000));
                    } else if (body && typeof body === 'object') {
                        // FormData или другой объект
                        console.log('[TM] 🌳🔧 BODY объект, конструктор:', body.constructor ? body.constructor.name : '?');
                        if (typeof FormData !== 'undefined' && body instanceof FormData) {
                            var fdParts = [];
                            for (var pair of body.entries()) {
                                fdParts.push(pair[0] + '=' + encodeURIComponent(pair[1]));
                            }
                            console.log('[TM] 🌳🔧 FormData (' + fdParts.length + ' полей):', fdParts.join('&').substring(0, 2000));
                        } else {
                            try { console.log('[TM] 🌳🔧 BODY JSON:', JSON.stringify(body).substring(0, 2000)); } catch(e) {}
                        }
                    }
                    console.log('[TM] 🌳🔧=== КОНЕЦ XHR ===');
                }
                return _origSend.apply(this, arguments);
            };
            // Отключаем хук через 60 секунд
            setTimeout(function() {
                XMLHttpRequest.prototype.open = _origOpen;
                XMLHttpRequest.prototype.send = _origSend;
                console.log('[TM] 🌳🔧 XHR hook отключён');
            }, 60000);
        }

        return; // ← на Forest больше ничего не делаем
    }

    // ═════════════════════════════════════════════════════════════
    //  РЕЖИМ BILLING — основная логика
    // ═════════════════════════════════════════════════════════════
    if (!window.location.hash.includes('incidents')) return;

    // ==================================================================
    //  ШАБЛОНЫ (хранятся в localStorage, инициализация по умолчанию)
    // ==================================================================
    const STORAGE_KEY = 'tm_incident_templates';

    function getTemplates() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        // Шаблоны по умолчанию
        return [
            {
                name: 'Скорость интернета',
                text: 'Здравствуйте,\n\nПри первичной диагностике проблем с сигналом не зафиксировано. Уровень сигнала в норме, скорость сетевого соединения в норме.\nДля корректного замера скорости необходимо подключаться кабелем к компьютеру или ноутбуку, без роутера. Просьба провести замер данным способом. Если такой возможности нет, то можно и по wi-fi, но он может некорректно отображать скорость услуги, это может быть связано с физическими преградами (стены), помехами от других сетей, старым оборудованием или одновременным использованием интернета множеством устройств.\nПри замере скорости по wi-fi следует:\n1. Отключить другие устройства от сети wi-fi.\n2. Если роутер двухдиапазонный и имеет 2 сети wi-fi, подключиться к сети 5 ГГц (Так как сеть 2.4 ГГц ниже скоростью, но большей зоной покрытия).\n3. При замере находиться необходимо рядом с роутером.\n4. Закрыть другие вкладки в браузере.\nОбратите внимание, в данном случае замер будет считаться также некорректным и применяется только в том случае, если нет возможности подключиться напрямую по проводу, минуя роутер.'
            },
            {
                name: 'Приостановка УЗ',
                text: 'Здравствуйте, приостановили учетную запись по вашему запросу'
            },
            {
                name: 'Общая',
                text: 'Здравствуйте,\n\nВ данный момент ваш адрес относится к общей проблеме на нашей сети.\nСпециалисты делают все возможное для скорейшего восстановления сервиса.\nПриносим извинения за доставленные неудобства.'
            },
        ];
    }

    function saveTemplates(tpls) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tpls));
    }

    // ==================================================================
    //  ПОИСК ЭЛЕМЕНТОВ
    // ==================================================================
    let pollCount = 0;

    // Кнопка "Копировать менеджерам" (в тулбаре ТТ)
    function findCopyBtn() {
        const copyIcons = document.querySelectorAll('.x-ibtn-copy');
        for (const icon of copyIcons) {
            const btn = icon.closest('.x-btn');
            if (!btn) continue;
            if (btn.offsetParent === null) continue;
            const inner = btn.querySelector('.x-btn-inner');
            if (!inner || inner.textContent.trim() !== 'Копировать менеджерам') continue;
            if (!btn.closest('.x-toolbar')) continue;
            return btn;
        }
        return null;
    }

    // Текстовое поле "Сообщение" в панели "Добавить"
    function findMessageField() {
        // По name="text" — это поле "Сообщение"
        const textarea = document.querySelector('textarea[name="text"]');
        if (!textarea) return null;
        if (textarea.offsetParent === null) return null; // невидима
        return textarea;
    }

    // ==================================================================
    //  СОЗДАНИЕ КНОПОК (стиль ExtJS)
    // ==================================================================
    function createButton(id, text, iconClass, onClick) {
        const uid = id + '-' + Date.now();

        const btn = document.createElement('a');
        btn.className = 'x-btn x-box-item x-toolbar-item x-btn-default-small x-selectable';
        btn.id = uid;
        btn.setAttribute('hidefocus', 'on');
        btn.setAttribute('unselectable', 'on');
        btn.setAttribute('tabindex', '-1');
        btn.style.cssText = 'position: absolute; right: auto; top: 0px; margin: 0px 0px 0px 5px;';

        const wrap = document.createElement('span');
        wrap.id = uid + '-btnWrap';
        wrap.setAttribute('data-ref', 'btnWrap');
        wrap.setAttribute('role', 'presentation');
        wrap.setAttribute('unselectable', 'on');
        wrap.className = 'x-btn-wrap x-btn-wrap-default-small';

        const hasIcon = iconClass && iconClass.trim();

        const el = document.createElement('span');
        el.id = uid + '-btnEl';
        el.setAttribute('data-ref', 'btnEl');
        el.setAttribute('role', 'presentation');
        el.setAttribute('unselectable', 'on');
        el.className = 'x-btn-button x-btn-button-default-small x-btn-text  x-btn-button-center' + (hasIcon ? ' x-btn-icon x-btn-icon-left' : '');

        if (hasIcon) {
            const icon = document.createElement('span');
            icon.id = uid + '-btnIconEl';
            icon.setAttribute('data-ref', 'btnIconEl');
            icon.setAttribute('role', 'presentation');
            icon.setAttribute('unselectable', 'on');
            icon.className = 'x-btn-icon-el x-btn-icon-el-default-small ' + iconClass;
            icon.innerHTML = '&nbsp;';
            el.appendChild(icon);
        }

        const inner = document.createElement('span');
        inner.id = uid + '-btnInnerEl';
        inner.setAttribute('data-ref', 'btnInnerEl');
        inner.setAttribute('unselectable', 'on');
        inner.className = 'x-btn-inner x-btn-inner-default-small';
        inner.textContent = text;

        el.appendChild(inner);
        wrap.appendChild(el);
        btn.appendChild(wrap);

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            if (typeof onClick === 'function') onClick(e);
        });

        return btn;
    }

    function positionAfter(btn, refBtn) {
        const refLeft = parseInt(refBtn.style.left) || 0;
        const refWidth = refBtn.getBoundingClientRect().width || refBtn.offsetWidth || 0;
        btn.style.left = (refLeft + refWidth) + 'px';
    }

    // ==================================================================
    //  КНОПКА "Настроить шаблоны" В ТУЛБАРЕ ТТ
    // ==================================================================
    function addSettingsButton() {
        const refButton = findCopyBtn();
        if (!refButton) {
            pollCount++;
            if (pollCount % 20 === 1) console.log('[TM] Ожидаю открытия ТТ…');
            return false;
        }

        pollCount = 0;

        const target = refButton.closest('.x-box-target');
        if (!target) return false;
        if (target.querySelector('[id$="-btnInnerEl"]')?.textContent.trim() === 'Настроить шаблоны') {
            return true;
        }

        const btnSettings = createButton(
            'button-tm-settings',
            '\u2699 Настроить шаблоны',
            '',
            function() {
                editTemplatesDialog();
            }
        );

        refButton.parentNode.insertBefore(btnSettings, refButton.nextSibling);
        positionAfter(btnSettings, refButton);
        console.log('[TM] Кнопка "Настроить шаблоны" добавлена');

        // Кнопка "Создать ТТ"
        if (!target.querySelector('[id$="-btnInnerEl"]')?.textContent.trim().includes('Создать ТТ')) {
            var btnForest = createButton(
                'button-tm-forest',
                '\ud83c\udf33 Создать ТТ',
                '',
                function() {
                    if (!currentTTId) {
                        alert('Сначала откройте ТТ (кликните по заголовку в списке)');
                        return;
                    }
                    var firstClientMsgEl = document.querySelector('.sbss-message-by-client');
                    var firstAdminMsgEl = document.querySelector('.sbss-message-by-admin');
                    var firstClientMsg = firstClientMsgEl ? firstClientMsgEl.textContent.trim() : '(не найдено)';
                    var firstAdminMsg = firstAdminMsgEl ? firstAdminMsgEl.textContent.trim() : '(не найдено)';

                    // Проверяем, есть ли сохранённый шаблон сообщения
                    var templateMsg = GM_getValue('tm_forest_msg_tpl');
                    var templateSol = GM_getValue('tm_forest_sol_tpl');
                    if (templateMsg || templateSol) {
                        // Подставляем реальные данные вместо токенов
                        var descText = (templateMsg || '')
                            .replace(/\{TT_NUM\}/g, currentTTId)
                            .replace(/\{CLIENT_MSG\}/g, firstClientMsg.substring(0, 300))
                            .replace(/\{ADMIN_MSG\}/g, firstAdminMsg.substring(0, 300));
                        var solText = (templateSol || '')
                            .replace(/\{TT_NUM\}/g, currentTTId)
                            .replace(/\{CLIENT_MSG\}/g, firstClientMsg.substring(0, 5000))
                            .replace(/\{ADMIN_MSG\}/g, firstAdminMsg.substring(0, 5000));
                        console.log('[TM] 🌳 Использую шаблон сообщения с подстановкой токенов');
                    } else {
                        // Добавляем префикс "Ответ на ЛК:ID"
                        var prefix = 'Ответ на ЛК:' + currentTTId + ' - ';
                        var descText = prefix + firstClientMsg.substring(0, 5000) + (firstClientMsg.length > 5000 ? '...' : '');
                        var solText = prefix + firstAdminMsg.substring(0, 5000) + (firstAdminMsg.length > 5000 ? '...' : '');
                    }

                    // Сохраняем данные в GM_setValue для Forest
                    console.log('[TM] 🌳 Передача в Forest: msg=' + descText.substring(0, 80) + '...');
                    GM_setValue('tm_forest_msg', descText);
                    GM_setValue('tm_forest_sol', solText);
                    GM_setValue('tm_forest_state', '1');
                    GM_setValue('tm_forest_ts', '' + Date.now());
                    GM_setValue('tm_forest_intent', '' + Date.now());

                    // Сохраняем договор (если уже нашли — берём, если нет — пробуем найти)
                    var dogNum = currentContractId || findCurrentContract() || GM_getValue('tm_forest_dog_num');
                    if (dogNum) { dogNum = dogNum.replace(/\D/g, ''); }
                    if (dogNum) {
                        console.log('[TM] 🌳 Договор #' + dogNum + ' передан в Forest');
                        GM_setValue('tm_forest_dog_num', dogNum);
                        GM_setValue('tm_forest_dog_ts', '' + Date.now());
                        currentContractId = dogNum;
                    } else if (!contractApiPending) {
                        // Договор не найден — запускаем API прямо отсюда
                        console.log('[TM] 🌳 Договор не найден, запускаю API-поиск...');
                        var authorId = findAuthorIdFromStore();
                        if (authorId) {
                            startAsyncContractSearch(authorId);
                            alert('🌳 Ищу договор через API...\nПодождите пару секунд и нажмите "Создать ТТ" ещё раз.');
                            return; // Не открываем Forest сейчас
                        } else {
                            console.log('[TM] ❌ author_id не найден');
                            GM_deleteValue('tm_forest_dog_num');
                            GM_deleteValue('tm_forest_dog_ts');
                        }
                    } else {
                        // API уже выполняется
                        console.log('[TM] 🌳 Договор ещё не получен (API в процессе)');
                        alert('🌳 Договор ещё загружается...\nПодождите пару секунд и нажмите "Создать ТТ" ещё раз.');
                        return; // Не открываем Forest
                    }

                    // Проверяем фоновый режим (создание ТТ через API без открытия вкладки)
                    var bgMode = GM_getValue('tm_tt_background_mode');
                    if (bgMode && dogNum) {
                        console.log('[TM] 🌳 Фоновый режим: создаю ТТ через API...');
                        // Получаем clientData для vg_id, проверяем свежесть
                        var _clientDataStr = GM_getValue('tm_forest_client_data');
                        var _clientData = null;
                        try { _clientData = JSON.parse(_clientDataStr); } catch(e) {}
                        var _vgId;
                        if (_clientData && String(_clientData.agrm_num || '').replace(/\D/g, '') === dogNum) {
                            // Данные совпадают с текущим договором — используем vg_id
                            _vgId = String(_clientData.vg_id || _clientData.id || dogNum);
                            console.log('[TM] 🌳 vg_id из clientData: ' + _vgId);
                        } else {
                            // Данные устарели или для другого договора — используем номер договора
                            _vgId = dogNum;
                            console.log('[TM] 🌳 clientData устарел, vg_id = номер договора: ' + _vgId);
                        }
                        createTTInBackground(descText, solText, dogNum, _vgId);
                        console.log('[TM] 🌳 Фоновый запрос отправлен');
                        return;
                    }

                    // Открываем Forest в новой вкладке
                    // Там сработает скрипт timernet-forest-helper (нужно установить отдельно)
                    GM_openInTab('https://forest.timernet.ru/service-desk/tt/create', { active: true });

                    console.log('[TM] 🌳 Данные переданы в Forest. Страница открыта во вкладке.');
                }
            );
            refButton.parentNode.insertBefore(btnForest, btnSettings.nextSibling);
            positionAfter(btnForest, btnSettings);
            btnForest.style.left = (parseInt(btnForest.style.left) + 5) + 'px';
            btnForest.style.margin = '0px 5px 0px 5px';
            console.log('[TM] Кнопка "Создать ТТ" добавлена');
        }

        // Кнопка "Парсер"
        if (!target.querySelector('[id$="-btnInnerEl"]')?.textContent.trim().includes('Парсер')) {
            var btnParser = createButton(
                'button-tm-parser',
                '\ud83d\udd0d Парсер',
                '',
                function() {
                    // ── Кэш для этого ТТ уже есть? (per-TT) ──────────────
                    if (currentTTId) {
                        var _ttCached = GM_getValue('tm_parser_tt_' + currentTTId);
                        if (_ttCached) {
                            _parserShowResult(_ttCached);
                            console.log('[TM] Парсер: результат из кэша ТТ #' + currentTTId);
                            return;
                        }
                    }
                    // Ищем договор: сначала в DOM
                    var dogNum = findCurrentContract();
                    
                    if (!dogNum) {
                        // В DOM не найден — проверяем, может API уже сохранил свежий номер (до 10 сек)
                        var savedDog = GM_getValue('tm_forest_dog_num');
                        var savedTs = GM_getValue('tm_forest_dog_ts');
                        if (savedDog && savedTs && (Date.now() - parseInt(savedTs)) < 30000) {
                            dogNum = savedDog;
                            console.log('[TM] Парсер: договор #' + dogNum + ' взят из свежего кэша');
                        }
                    }

                    if (!dogNum) {
                        // Нет номера — ждём API (уже мог запуститься из интервала)
                        if (contractApiPending || currentContractId) {
                            // API уже запущен или договор скоро появится — ждём
                            var _waitToast = document.createElement('div');
                            _waitToast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999998; background: #0d6efd; color: #fff; border-radius: 10px; padding: 14px 18px; font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-family: Arial, sans-serif; max-width: 360px; display: flex; align-items: center; gap: 10px;';
                            _waitToast.innerHTML = '<span style="font-size:20px;">⏳</span><span><b>Загружаю номер договора…</b><br><small>Подождите несколько секунд</small></span>';
                            document.body.appendChild(_waitToast);
                            var _waitPoll = setInterval(function() {
                                if (currentContractId) {
                                    clearInterval(_waitPoll);
                                    if (_waitToast && _waitToast.parentNode) _waitToast.remove();
                                    // Пробуем снова с найденным номером
                                    if (btnParser) btnParser.click();
                                }
                            }, 500);
                            return;
                        }
                        // Нет ни кэша, ни API — пробуем запустить сейчас
                        if (!contractApiPending) {
                            var authorId = findAuthorIdFromStore();
                            if (authorId) {
                                console.log('[TM] Парсер: договор не найден, запускаю API...');
                                GM_deleteValue('tm_forest_dog_num');
                                GM_deleteValue('tm_forest_dog_ts');
                                startAsyncContractSearch(authorId);
                                alert('🌳 Загружаю данные...\nПодождите пару секунд и нажмите "Парсер" ещё раз.');
                                return;
                            }
                        }
                        alert('Не удалось найти номер договора.\nПопробуйте открыть ТТ через список "Инциденты".');
                        return;
                    }

                    // Сохраняем очищенный номер для fallback
                    var cleanDogNum = dogNum.replace(/\D/g, '');
                    if (!cleanDogNum) {
                        alert('Номер договора пуст');
                        return;
                    }

                    // ── Уже есть кэшированный результат? ─────────────────
                    var _cachedResult = GM_getValue('tm_parser_result');
                    var _cachedReady = GM_getValue('tm_parser_ready');
                    if (_cachedReady === '1' && _cachedResult) {
                        GM_deleteValue('tm_parser_ready');
                        _parserShowResult(_cachedResult);
                        console.log('[TM] Парсер: результат из кэша (авто-парсер уже выполнился)');
                        return;
                    }

                    // Billng API /vgroup удалён (8+ сек без пользы).
                    // Сразу переходим к PON-диагностике на Forest.
                    cleanDogNum = dogNum.replace(/\D/g, '');
                    if (!cleanDogNum) { alert('Номер договора пуст'); return; }

                    // ── Авто-парсер уже работает? ────────────────────────
                    if (_parserAutoRunning) {
                        var toast = document.getElementById('tm-parser-progress');
                        if (!toast) {
                            toast = document.createElement('div');
                            toast.id = 'tm-parser-progress';
                            toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999998; background: #0d6efd; color: #fff; border-radius: 10px; padding: 14px 18px; font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-family: Arial, sans-serif; max-width: 360px; display: flex; align-items: center; gap: 10px;';
                            toast.innerHTML = '<span style="font-size:20px;">⏳</span><span><b>Парсер работает в фоне…</b><br><small>Результат появится здесь через несколько секунд</small></span>';
                            document.body.appendChild(toast);
                        }
                        // Опрашиваем результат (прямой API уже сохранил в per-TT кэш)
                        var _poll = setInterval(function() {
                            if (!currentTTId) return;
                            var r = GM_getValue('tm_parser_tt_' + currentTTId);
                            if (r) {
                                clearInterval(_poll);
                                if (toast && toast.parentNode) toast.remove();
                                _parserShowResult(r);
                            }
                        }, 300);
                        setTimeout(function() { clearInterval(_poll); }, 60000);
                        return;
                    }

                    // ── Стартуем вручную (авто- не запустился) ──────────
                    _parserStart(cleanDogNum, GM_getValue('tm_forest_parser_login'));
                    // Показываем тост
                    var toast = document.createElement('div');
                    toast.id = 'tm-parser-progress';
                    toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999998; background: #0d6efd; color: #fff; border-radius: 10px; padding: 14px 18px; font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-family: Arial, sans-serif; max-width: 360px; display: flex; align-items: center; gap: 10px;';
                    toast.innerHTML = '<span style="font-size:20px;">⏳</span><span><b>Парсер работает в фоне…</b><br><small>Результат появится здесь через несколько секунд</small></span>';
                    document.body.appendChild(toast);
                    var _poll = setInterval(function() {
                        if (!currentTTId) return;
                        var r = GM_getValue('tm_parser_tt_' + currentTTId);
                        if (r) {
                            clearInterval(_poll);
                            if (toast && toast.parentNode) toast.remove();
                            _parserShowResult(r);
                        }
                    }, 300);
                    setTimeout(function() { clearInterval(_poll); }, 60000);
                }
            );
            refButton.parentNode.insertBefore(btnParser, btnForest.nextSibling);
            positionAfter(btnParser, btnForest);
            btnParser.style.margin = '0px 0px 0px 10px';
            console.log('[TM] Кнопка "Парсер" добавлена');
        }

        return true;
    }

    // ==================================================================
    //  БЛОК ШАБЛОНОВ В ПАНЕЛИ "Добавить"
    // ==================================================================
    function addTemplatesToForm() {
        const textarea = findMessageField();
        if (!textarea) return false;

        // Проверяем, не добавлен ли уже блок
        if (document.querySelector('.tm-templates-block')) return true;

        // Ищем контейнер для вставки: поле textarea в ExtJS форме
        const field = textarea.closest('.x-field') || textarea.parentElement;
        if (!field) return false;

        // Создаём блок шаблонов
        const block = document.createElement('div');
        block.className = 'tm-templates-block';
        block.style.cssText = 'margin: 8px 0 4px 0; padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 3px;';

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 11px; color: #666; margin-bottom: 4px; font-weight: bold;';
        title.textContent = 'Шаблоны сообщения:';

        block.appendChild(title);

        const templates = getTemplates();
        const linksWrap = document.createElement('div');
        linksWrap.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';

        templates.forEach(function(tpl, index) {
            const link = document.createElement('a');
            link.href = '#';
            link.style.cssText = 'font-size: 13px; padding: 4px 10px; background: #fff; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; color: #333; text-decoration: none; display: flex; align-items: center; gap: 6px;';
            link.title = tpl.text.replace(/\\n/g, '\n');

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight: bold; white-space: nowrap; flex-shrink: 0; min-width: 110px;';
            nameSpan.textContent = tpl.name;

            const textSpan = document.createElement('span');
            textSpan.style.cssText = 'color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: 12px;';
            // первая строка текста, обрезаем (нормализуем \n → newline)
            const firstLine = tpl.text.replace(/\\n/g, '\n').split('\n')[0] || '';
            textSpan.textContent = firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;

            link.appendChild(nameSpan);
            link.appendChild(textSpan);

            link.addEventListener('click', function(e) {
                e.preventDefault();
                insertTemplate(textarea, tpl.text);
            });

            linksWrap.appendChild(link);
        });

        block.appendChild(linksWrap);

        // Вставляем ПОСЛЕ поля textarea (а не внутрь x-autocontainer-innerCt)
        field.parentNode.insertBefore(block, field.nextSibling);

        // Растягиваем контейнер формы, чтобы блок шаблонов не обрезался
        var ct = textarea.closest('.x-autocontainer-innerCt');
        if (ct) {
            ct.style.overflow = 'visible';
            ct.style.height = 'auto';
        }
        // Поднимаемся выше — body формы
        var panel = textarea.closest('.x-panel-body') || textarea.closest('.x-panel');
        if (panel) {
            panel.style.overflow = 'visible';
            panel.style.height = 'auto';
        }
        // Триггерим пересчёт layout (штатный способ для ExtJS)
        window.dispatchEvent(new Event('resize'));

        console.log('[TM] Блок шаблонов добавлен в форму');
        hookAddButton();
        return true;
    }

    // Вставка текста шаблона в textarea
    function insertTemplate(textarea, text) {
        // Нормализуем переносы (\n → настоящие newline)
        text = text.replace(/\\n/g, '\n');
        // Устанавливаем значение
        textarea.value = text;
        // Триггерим событие input, чтобы ExtJS узнал об изменении
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        // Фокус
        textarea.focus();
    }

    // ── Авто-установка статуса "Ответ" при клике на "Добавить" ──────
    function hookAddButton() {
        var btns = document.querySelectorAll('.x-btn-inner');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Добавить') {
                var btn = btns[i].closest('.x-btn');
                if (btn && !btn._tm_hooked) {
                    btn._tm_hooked = true;
                    btn.addEventListener('click', function() {
                        setStatusToAnswer();
                    });
                    console.log('[TM] ✅ Хук на кнопку "Добавить" — статус → Ответ');
                }
                break;
            }
        }
    }

    function setStatusToAnswer() {
        try {
            var pageExt = (typeof unsafeWindow !== 'undefined') ? unsafeWindow.Ext : null;
            if (pageExt) {
                var combos = pageExt.ComponentQuery.query('combobox[name="status_id"]');
                if (combos && combos.length > 0) {
                    var combo = combos[0];
                    var store = combo.getStore();
                    if (store) {
                        var idx = store.findExact('text', 'Ответ');
                        if (idx !== -1) {
                            var record = store.getAt(idx);
                            combo.setValue(record.get('value') || record.get('id'));
                            console.log('[TM] ✅ Статус → Ответ (ExtJS)');
                            return;
                        }
                    }
                    combo.setValue('Ответ');
                    console.log('[TM] ✅ Статус → Ответ (ExtJS fallback)');
                    return;
                }
            }
            // DOM fallback
            var statusInput = document.querySelector('input[name="status_id"]');
            if (statusInput && !statusInput.readOnly) {
                statusInput.value = 'Ответ';
                statusInput.dispatchEvent(new Event('input', { bubbles: true }));
                statusInput.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('[TM] ✅ Статус → Ответ (DOM)');
            }
        } catch(e) {
            console.log('[TM] Ошибка установки статуса:', e.message);
        }
    }

    // ==================================================================
    //  ДИАЛОГ НАСТРОЙКИ ШАБЛОНОВ
    // ==================================================================
    function editTemplatesDialog() {
        // ── Inject modern styles once ────────────────────────────────
        if (!document.getElementById('tm-dialog-styles')) {
            const style = document.createElement('style');
            style.id = 'tm-dialog-styles';
            style.textContent = `
                .tm-dialog {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
                    position: fixed;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 99999;
                    background: #fff;
                    border: none;
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 440px;
                    max-width: 640px;
                    max-height: 85vh;
                    overflow-y: auto;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.06);
                    font-size: 14px;
                    line-height: 1.5;
                }
                .tm-dialog-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 99998;
                    background: rgba(0,0,0,0.45);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                }
                .tm-dialog-title {
                    font-size: 17px;
                    font-weight: 600;
                    margin-bottom: 4px;
                    color: #111;
                }
                .tm-dialog-subtitle {
                    font-size: 13px;
                    color: #6b7280;
                    margin-bottom: 16px;
                }
                .tm-card {
                    position: relative;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 10px;
                    background: #fff;
                    transition: box-shadow 0.15s, border-color 0.15s;
                }
                .tm-card:hover {
                    box-shadow: 0 2px 10px rgba(0,0,0,0.07);
                }
                .tm-card.dragging {
                    opacity: 0.35;
                    cursor: grabbing;
                }
                .tm-card.drag-over {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
                }
                .tm-drag-handle {
                    position: absolute;
                    top: 10px;
                    right: 14px;
                    font-size: 14px;
                    color: #d1d5db;
                    cursor: grab;
                    user-select: none;
                    line-height: 1;
                    padding: 2px 4px;
                }
                .tm-drag-handle:hover {
                    color: #6b7280;
                }
                .tm-input, .tm-textarea {
                    width: 100%;
                    box-sizing: border-box;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    padding: 7px 10px;
                    font-size: 13px;
                    font-family: inherit;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    outline: none;
                    background: #fff;
                    color: #111;
                }
                .tm-input:focus, .tm-textarea:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
                }
                .tm-input { width: 240px; }
                .tm-textarea { min-height: 54px; resize: vertical; }
                .tm-btn {
                    border: none;
                    border-radius: 6px;
                    padding: 6px 14px;
                    font-size: 13px;
                    font-family: inherit;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
                    line-height: 1.4;
                }
                .tm-btn:hover { transform: translateY(-1px); }
                .tm-btn:active { transform: translateY(0); }
                .tm-btn-primary { background: #3b82f6; color: #fff; }
                .tm-btn-primary:hover { background: #2563eb; }
                .tm-btn-success { background: #10b981; color: #fff; }
                .tm-btn-success:hover { background: #059669; }
                .tm-btn-default { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
                .tm-btn-default:hover { background: #e5e7eb; }
                .tm-btn-ghost { background: transparent; color: #6b7280; border: 1px solid #d1d5db; }
                .tm-btn-ghost:hover { background: #f9fafb; }
                .tm-btn-danger { background: transparent; color: #ef4444; border: 1px solid #fca5a5; }
                .tm-btn-danger:hover { background: #fef2f2; }
                .tm-btn-sm { padding: 3px 10px; font-size: 12px; }
                .tm-btn-group { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
                .tm-footer-text { font-size: 11px; color: #9ca3af; margin-top: 8px; }
                .tm-empty { color: #9ca3af; padding: 12px 0; text-align: center; font-size: 13px; }
                @keyframes leafGrow {
                    0% { opacity: 0; transform: scaleX(0.05) scaleY(0.1); }
                    55% { opacity: 1; transform: scaleX(1.05) scaleY(1.05); }
                    100% { opacity: 1; transform: scaleX(1) scaleY(1); }
                }
                @keyframes leafShrink {
                    0% { opacity: 1; transform: scaleX(1) scaleY(1); }
                    60% { opacity: 0.3; transform: scaleX(0.05) scaleY(0.05); }
                    100% { opacity: 0; transform: scaleX(0) scaleY(0); }
                }
                .tm-btn-forest-msg {
                    background: #059669;
                    color: #fff;
                    border: none;
                    border-radius: 6px;
                    padding: 6px 14px;
                    font-size: 13px;
                    font-family: inherit;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    transition: background 0.15s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
                    line-height: 1.4;
                    white-space: nowrap;
                    position: relative;
                    z-index: 1;
                }
                .tm-btn-forest-msg:hover { background: #047857; transform: translateY(-1px); }
                .tm-btn-forest-msg:active { transform: translateY(0); }
                .tm-btn-forest-msg.slide-out {
                    pointer-events: none;
                }
                .tm-btn-forest-msg.slide-back {
                    pointer-events: auto;
                }
                .tm-forest-panel {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
                    position: fixed;
                    z-index: 99999;
                    background: #fff;
                    border: none;
                    border-radius: 12px;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.25);
                    box-sizing: border-box;
                    padding: 30px 25px 25px 20px;
                    display: flex;
                    flex-direction: column;
                    font-size: 14px;
                    line-height: 1.5;
                    overflow: hidden;
                    transform-origin: left center;
                }
                .tm-forest-panel.leaf-open {
                    animation: leafGrow 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
                .tm-forest-panel.leaf-close {
                    animation: leafShrink 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
                
                .tm-forest-panel ::placeholder { color: #9ca3af; }
                .tm-forest-panel .tm-textarea {
                    background: #fff;
                    border-color: #d1d5db;
                    color: #111;
                }
                .tm-forest-panel .tm-textarea:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
                }
                .tm-forest-token {
                    display: inline-block;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: grab;
                    user-select: none;
                    transition: transform 0.1s, box-shadow 0.1s;
                }
                .tm-forest-token:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .tm-forest-token:active { cursor: grabbing; }
                .tm-forest-token-tt { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
                .tm-forest-token-client { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
                .tm-forest-token-admin { background: #fef3c7; border: 1px solid #fde68a; color: #92400e; }
            `;
            document.head.appendChild(style);
        }

        // ── Build dialog ────────────────────────────────────────────
        const templates = getTemplates();

        const overlay = document.createElement('div');
        overlay.className = 'tm-dialog-overlay';
        document.body.appendChild(overlay);

        const menu = document.createElement('div');
        menu.className = 'tm-dialog';
        var bgModeChecked = GM_getValue('tm_tt_background_mode') ? ' checked' : '';
        menu.innerHTML =
            '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">' +
            '  <div>' +
            '    <div class="tm-dialog-title">⚙️ Настройка шаблонов</div>' +
            '    <div class="tm-dialog-subtitle" style="margin-bottom: 0;">Текущие шаблоны (' + templates.length + ')</div>' +
            '  </div>' +
            '  <div style="display: flex; align-items: center; gap: 12px; white-space: nowrap;">' +
            '    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #374151; cursor: pointer; user-select: none;">' +
            '      <input type="checkbox" id="tm-bg-mode"' + bgModeChecked + '> Создавать ТТ в фоновом режиме' +
            '    </label>' +
            '    <button id="tm-btn-forest-msg" class="tm-btn tm-btn-forest-msg">🌳 Изменить сообщение в Forest</button>' +
            '  </div>' +
            '</div>' +
            '<div id="tm-template-list" style="margin-bottom: 14px;"></div>' +
            '<div class="tm-btn-group">' +
            '  <button id="tm-btn-export" class="tm-btn tm-btn-default">⬇ Скачать данные шаблоны</button>' +
            '  <button id="tm-btn-import" class="tm-btn tm-btn-default">⬆ Загрузить чужие шаблоны</button>' +
            '  <button id="tm-btn-save-all" class="tm-btn tm-btn-primary">💾 Сохранить</button>' +
            '</div>' +
            '<div class="tm-footer-text">💡 Чтобы поменять шаблоны местами — потяните за ручку ⠿ в правом верхнем углу карточки</div>';

        document.body.appendChild(menu);

        // ── Render list ──────────────────────────────────────────────
        function renderList() {
            const listEl = document.getElementById('tm-template-list');
            if (!listEl) return;
            const tpls = getTemplates();
            let html = '';
            var total = tpls.length;
            tpls.forEach(function(t, i) {
                var isLast = (i === total - 1);
                html +=
                    '<div class="tm-card" data-idx="' + i + '">' +
                    '  <span class="tm-drag-handle" draggable="true" title="Перетащите чтобы изменить порядок">⠿</span>' +
                    '  <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
                    '    <button data-idx="' + i + '" class="tm-btn-del tm-btn tm-btn-danger tm-btn-sm">✕</button>' +
                    '    <input id="tm-name-' + i + '" class="tm-input" value="' + escapeHtml(t.name) + '" placeholder="Название шаблона">' +
                    '  </div>' +
                    '  <div style="margin-bottom: 6px;">' +
                    '    <textarea id="tm-text-' + i + '" class="tm-textarea" placeholder="Текст шаблона">' + escapeHtml(t.text) + '</textarea>' +
                    '  </div>' +
                    (isLast ? '<div style="margin-top:8px;"><button id="tm-btn-add" class="tm-btn tm-btn-success" style="width:100%;" title="Добавить новый шаблон">＋ Добавить шаблон</button></div>' : '') +
                    '</div>';
            });
            if (total === 0) {
                html = '<div class="tm-empty">Нет шаблонов.</div>' +
                       '<div style="margin-top:12px;"><button id="tm-btn-add" class="tm-btn tm-btn-success" style="width:100%;" title="Добавить новый шаблон">＋ Добавить шаблон</button></div>';
            }
            listEl.innerHTML = html;

            // Кнопки "Удалить" — с подтверждением и отменой 5 сек
            listEl.querySelectorAll('.tm-btn-del').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    const idx = parseInt(this.dataset.idx);
                    const tpls = getTemplates();
                    const tpl = tpls[idx];
                    if (!tpl) return;

                    // Подтверждение
                    if (!confirm('Точно удалить шаблон «' + tpl.name + '»?')) return;

                    // Сохраняем данные на случай отмены
                    const saved = { name: tpl.name, text: tpl.text };

                    // Удаляем из хранилища сразу
                    tpls.splice(idx, 1);
                    saveTemplates(tpls);
                    renderList();
                    updateFormTemplates();

                    // Убираем старый toast, если был
                    var oldToast = document.getElementById('tm-undo-toast');
                    if (oldToast) oldToast.remove();

                    // Показываем toast с отменой
                    var toast = document.createElement('div');
                    toast.id = 'tm-undo-toast';
                    toast.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-top: 8px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; color: #991b1b;';
                    toast.innerHTML =
                        '<span>🗑 Осталось времени чтобы вернуть: <b id="tm-undo-countdown">5</b>с</span>' +
                        '<button id="tm-undo-btn" class="tm-btn tm-btn-default tm-btn-sm" style="margin-left: auto;">↩ Вернуть</button>';
                    // Вставляем после списка шаблонов, до кнопок
                    listEl.parentNode.insertBefore(toast, listEl.nextSibling);

                    // Таймер 5 сек
                    var seconds = 5;
                    var countdownEl = document.getElementById('tm-undo-countdown');
                    var timer = setInterval(function() {
                        seconds--;
                        if (countdownEl) countdownEl.textContent = seconds;
                        if (seconds <= 0) {
                            clearInterval(timer);
                            var t = document.getElementById('tm-undo-toast');
                            if (t) t.remove();
                        }
                    }, 1000);

                    // Кнопка "Вернуть"
                    document.getElementById('tm-undo-btn').addEventListener('click', function() {
                        clearInterval(timer);
                        var t = document.getElementById('tm-undo-toast');
                        if (t) t.remove();
                        // Восстанавливаем
                        var curr = getTemplates();
                        curr.splice(idx, 0, saved);
                        saveTemplates(curr);
                        renderList();
                        updateFormTemplates();
                    });
                });
            });

            // ── Drag & Drop: перетаскивание шаблонов за ручку ⠿ ──
            listEl.querySelectorAll('.tm-card').forEach(function(card) {
                card.addEventListener('dragstart', function(e) {
                    // Только если тащили за drag-handle
                    if (!e.target.closest('.tm-drag-handle')) {
                        e.preventDefault();
                        return false;
                    }
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', this.dataset.idx);
                    this.classList.add('dragging');

                    // Кастомный drag-образ: полупрозрачная копия всей карточки
                    var ghost = this.cloneNode(true);
                    var rect = this.getBoundingClientRect();
                    ghost.style.cssText = 'position: fixed; top: -9999px; left: -9999px; opacity: 0.75; transform: scale(0.95); box-shadow: 0 8px 30px rgba(0,0,0,0.25); border-radius: 8px; pointer-events: none; z-index: 99999; background: #fff; padding: 12px; width: ' + this.offsetWidth + 'px;';
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
                    // Удалим призрак через секунду (dragend сработает позже)
                    setTimeout(function() { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 1000);
                });

                card.addEventListener('dragend', function() {
                    this.classList.remove('dragging');
                    listEl.querySelectorAll('.tm-card').forEach(function(c) { c.classList.remove('drag-over'); });
                });

                card.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    this.classList.add('drag-over');
                });

                card.addEventListener('dragleave', function() {
                    this.classList.remove('drag-over');
                });

                card.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.classList.remove('drag-over');

                    var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                    var toIdx = parseInt(this.dataset.idx);
                    if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx === toIdx) return;

                    var tpls = getTemplates();
                    var moved = tpls.splice(fromIdx, 1)[0];
                    tpls.splice(toIdx, 0, moved);
                    saveTemplates(tpls);
                    renderList();
                    updateFormTemplates();
                });
            });
        }

        renderList();

        // ── Чекбокс фонового режима — сохраняем состояние ───────────
        var bgCb = document.getElementById('tm-bg-mode');
        if (bgCb) {
            bgCb.addEventListener('change', function() {
                GM_setValue('tm_tt_background_mode', this.checked ? '1' : '');
                console.log('[TM] 🌳 Фоновый режим создания ТТ: ' + (this.checked ? 'ВКЛ' : 'ВЫКЛ'));
            });
        }

        // ── Кнопка ＋ Добавить (делегирование — переживает renderList) ─
        menu.addEventListener('click', function(e) {
            if (e.target.id === 'tm-btn-add') {
                const tpls = getTemplates();
                tpls.push({ name: 'Новый шаблон', text: '' });
                saveTemplates(tpls);
                renderList();
                updateFormTemplates();
            }
        });

        // ── Кнопка ⬇ Скачать ────────────────────────────────────────
        document.getElementById('tm-btn-export').addEventListener('click', function() {
            // Сохраняем поля перед экспортом
            const tpls = getTemplates();
            const listEl = document.getElementById('tm-template-list');
            tpls.forEach(function(t, i) {
                const nameInput = document.getElementById('tm-name-' + i);
                const textInput = document.getElementById('tm-text-' + i);
                if (nameInput) t.name = nameInput.value.trim() || 'Шаблон ' + (i + 1);
                if (textInput) t.text = textInput.value;
            });
            saveTemplates(tpls);

            const blob = new Blob([JSON.stringify(tpls, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tm_templates_' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        // ── Кнопка ⬆ Загрузить ──────────────────────────────────────
        document.getElementById('tm-btn-import').addEventListener('click', function() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function(ev) {
                    try {
                        const imported = JSON.parse(ev.target.result);
                        if (!Array.isArray(imported) || !imported.every(function(x) { return x && typeof x.name === 'string' && typeof x.text === 'string'; })) {
                            alert('Ошибка: неверный формат файла. Ожидается массив объектов { name, text }.');
                            return;
                        }
                        if (!confirm('Загрузить ' + imported.length + ' шаблон(ов)? Текущие шаблоны будут заменены.')) return;
                        saveTemplates(imported);
                        renderList();
                        updateFormTemplates();
                    } catch(e2) {
                        alert('Ошибка чтения файла: ' + e2.message);
                    }
                };
                reader.readAsText(file);
            });
            input.click();
        });

        // ── Кнопка 🌳 Изменить сообщение в Forest ──────────────────
        var forestPanel = null;
        var forestBtnRect = null; // сохранённая позиция кнопки для обратной анимации

        /**
         * Анимированное закрытие панели: кнопка летит обратно, панель схлопывается
         */
        function animateForestClose(btnEl) {
            if (!forestPanel) return;

            // Схлопывание панели
            forestPanel.className = 'tm-forest-panel leaf-close';

            // Кнопка на body, position:fixed у панели — летим обратно
            btnEl.style.transition = 'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            btnEl.style.left = forestBtnRect.left + 'px';
            btnEl.style.top = forestBtnRect.top + 'px';

            setTimeout(function() {
                // Возвращаем кнопку в диалог (перед заглушкой)
                var placeholder = document.getElementById('tm-forest-placeholder');
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(btnEl, placeholder);
                    placeholder.remove();
                }

                // Сбрасываем transition до сброса позиции чтобы не было рывка
                btnEl.style.transition = 'none';
                btnEl.style.position = '';
                btnEl.style.left = '';
                btnEl.style.top = '';
                btnEl.style.width = '';
                btnEl.style.height = '';
                btnEl.style.margin = '';
                btnEl.style.zIndex = '';
                btnEl.style.transform = '';
                btnEl.style.opacity = '';
                btnEl.style.pointerEvents = '';
                btnEl.classList.remove('slide-out', 'slide-back');

                if (forestPanel) { forestPanel.remove(); forestPanel = null; }
                forestBtnRect = null;
            }, 450);
        }

        document.getElementById('tm-btn-forest-msg').addEventListener('click', function() {
            var btnEl = document.getElementById('tm-btn-forest-msg');

            if (forestPanel) {
                // ── Закрытие: кнопка летит обратно ───────────────
                animateForestClose(btnEl);
                return;
            }

            var dialogRect = menu.getBoundingClientRect();

            // Сохраняем позицию кнопки в вьюпорте для расчёта полёта
            forestBtnRect = btnEl.getBoundingClientRect();

            // ── Создаём панель (анимация leafGrow через CSS) ─────
            forestPanel = document.createElement('div');
            forestPanel.className = 'tm-forest-panel leaf-open';
            forestPanel.id = 'tm-forest-panel';
            forestPanel.style.top = dialogRect.top + 'px';
            forestPanel.style.left = (dialogRect.right + 28) + 'px';
            forestPanel.style.width = '460px';
            forestPanel.style.height = Math.round(dialogRect.height / 1.5 + 150) + 'px';

            forestPanel.innerHTML =
                '<div style="margin-top: 50px; margin-bottom: 12px;">' +
                '  <div style="font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px;">📝 Описание проблемы</div>' +
                '  <textarea id="tm-forest-desc" class="tm-textarea" style="min-height: 70px; width: 100%;" placeholder="Описание проблемы..."></textarea>' +
                '</div>' +
                '<div style="margin-bottom: 12px;">' +
                '  <div style="font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px;">💡 Решение</div>' +
                '  <textarea id="tm-forest-sol" class="tm-textarea" style="min-height: 70px; width: 100%;" placeholder="Решение..."></textarea>' +
                '</div>' +
                '<div style="margin-top: auto; border-top: 1px solid #e5e7eb; padding-top: 12px;">' +
                '  <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">🖱 Перетащите в поля:</div>' +
                '  <div style="display: flex; flex-wrap: wrap; gap: 6px;">' +
                '    <span class="tm-forest-token tm-forest-token-tt" data-token="{TT_NUM}" draggable="true">📌 номер ТТ</span>' +
                '    <span class="tm-forest-token tm-forest-token-client" data-token="{CLIENT_MSG}" draggable="true">💬 сообщение абонента</span>' +
                '    <span class="tm-forest-token tm-forest-token-admin" data-token="{ADMIN_MSG}" draggable="true">📋 сообщение администратора</span>' +
                '  </div>' +
                '  <button id="tm-forest-save" class="tm-btn tm-btn-success" style="width: 100%; margin-top: 8px; padding: 8px 14px; font-size: 14px;">💾 Сохранить шаблон</button>' +
                '  <div id="tm-forest-preview" style="margin-top: 10px; padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; color: #374151; white-space: pre-wrap; min-height: 36px; max-height: 120px; overflow-y: auto;">' +
                '    <span style="color: #9ca3af;">Предварительный просмотр... (перетащите токены в поля)</span>' +
                '  </div>' +
                '</div>';

            document.body.appendChild(forestPanel);

            // ═══════════════════════════════════════════════════════
            //  АНИМАЦИЯ ПОЛЁТА КНОПКИ В ПАНЕЛЬ — перемещаем в body,
            //  чтобы выйти из stacking context диалога (transform)
            // ═══════════════════════════════════════════════════════
            // Цель: левый край контентной области панели
            var targetLeft = dialogRect.right + 28 + 20;
            var targetTop = dialogRect.top + 30;

            // Вставляем заглушку чтобы flex-раскладка диалога не сломалась
            var placeholder = document.createElement('span');
            placeholder.id = 'tm-forest-placeholder';
            placeholder.style.display = 'inline-block';
            placeholder.style.width = forestBtnRect.width + 'px';
            placeholder.style.height = forestBtnRect.height + 'px';
            btnEl.parentNode.insertBefore(placeholder, btnEl);

            // Перемещаем кнопку в body — теперь она выше stacking context диалога
            btnEl.remove();
            document.body.appendChild(btnEl);

            // Кадр 1: position:fixed на исходной позиции (без transition)
            requestAnimationFrame(function() {
                btnEl.style.transition = 'none';
                btnEl.style.position = 'fixed';
                btnEl.style.left = forestBtnRect.left + 'px';
                btnEl.style.top = forestBtnRect.top + 'px';
                btnEl.style.width = forestBtnRect.width + 'px';
                btnEl.style.height = forestBtnRect.height + 'px';
                btnEl.style.margin = '0';
                btnEl.style.zIndex = '100001';
                btnEl.style.pointerEvents = 'auto';
                btnEl.style.opacity = '1';
                btnEl.style.transform = 'none';

                // Кадр 2: летим к левому краю панели
                requestAnimationFrame(function() {
                    btnEl.style.transition = 'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    btnEl.style.left = targetLeft + 'px';
                    btnEl.style.top = targetTop + 'px';
                });
            });

            // ── Загрузка сохранённого шаблона (или значения по умолчанию) ──
            var defaultDesc = 'Ответ на ЛК:{TT_NUM} - {CLIENT_MSG}';
            var defaultSol = '{ADMIN_MSG}';
            var savedDesc = GM_getValue('tm_forest_msg_tpl');
            var savedSol = GM_getValue('tm_forest_sol_tpl');
            document.getElementById('tm-forest-desc').value = savedDesc || defaultDesc;
            document.getElementById('tm-forest-sol').value = savedSol || defaultSol;
            updateForestPreview();

            // ── Кнопка 💾 Сохранить ───────────────────────────────
            document.getElementById('tm-forest-save').addEventListener('click', function() {
                var desc = document.getElementById('tm-forest-desc').value;
                var sol = document.getElementById('tm-forest-sol').value;
                GM_setValue('tm_forest_msg_tpl', desc);
                GM_setValue('tm_forest_sol_tpl', sol);
                GM_setValue('tm_forest_state', '1');
                GM_setValue('tm_forest_ts', '' + Date.now());
                // Показываем вспышку что сохранено
                var btn = this;
                var origText = btn.textContent;
                btn.textContent = '✅ Сохранено!';
                btn.style.background = '#047857';
                setTimeout(function() {
                    btn.textContent = origText;
                    btn.style.background = '';
                }, 1500);
                console.log('[TM] 🌳 Шаблон сообщения Forest сохранён');
            });

            // ── Drag токенов ──────────────────────────────────────
            forestPanel.querySelectorAll('.tm-forest-token').forEach(function(token) {
                token.addEventListener('dragstart', function(e) {
                    e.dataTransfer.setData('text/plain', this.dataset.token);
                    e.dataTransfer.effectAllowed = 'copy';
                });
            });

            // ── Drop на textarea ──────────────────────────────────
            function setupTextareaDrop(taId) {
                var ta = document.getElementById(taId);
                if (!ta) return;
                ta.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                });
                ta.addEventListener('drop', function(e) {
                    e.preventDefault();
                    var token = e.dataTransfer.getData('text/plain');
                    if (!token) return;
                    var cursorPos = this.selectionStart;
                    var val = this.value;
                    this.value = val.substring(0, cursorPos) + token + val.substring(this.selectionEnd);
                    this.dispatchEvent(new Event('input', { bubbles: true }));
                    this.focus();
                });
            }
            setupTextareaDrop('tm-forest-desc');
            setupTextareaDrop('tm-forest-sol');

            // ── Предпросмотр ──────────────────────────────────────
            function updateForestPreview() {
                var preview = document.getElementById('tm-forest-preview');
                if (!preview) return;
                var descVal = document.getElementById('tm-forest-desc').value;
                var solVal = document.getElementById('tm-forest-sol').value;
                var rendered = '📝 Описание:\n' + (descVal || '(пусто)') + '\n\n💡 Решение:\n' + (solVal || '(пусто)');
                // Подмена токенов на демо-значения
                rendered = rendered
                    .replace(/\{TT_NUM\}/g, '12345')
                    .replace(/\{CLIENT_MSG\}/g, 'Не работает интернет')
                    .replace(/\{ADMIN_MSG\}/g, 'Проверьте кабель');
                preview.textContent = rendered;
            }

            document.getElementById('tm-forest-desc').addEventListener('input', updateForestPreview);
            document.getElementById('tm-forest-sol').addEventListener('input', updateForestPreview);
            updateForestPreview();

            // ── Закрытие панели при закрытии диалога ──────────────
            var closePanel = function() {
                // Возвращаем кнопку в диалог (перед заглушкой)
                var placeholder = document.getElementById('tm-forest-placeholder');
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(btnEl, placeholder);
                    placeholder.remove();
                }

                // Сбрасываем inline-стили кнопки
                btnEl.style.transition = 'none';
                btnEl.style.position = '';
                btnEl.style.left = '';
                btnEl.style.top = '';
                btnEl.style.width = '';
                btnEl.style.height = '';
                btnEl.style.margin = '';
                btnEl.style.zIndex = '';
                btnEl.style.transform = '';
                btnEl.style.opacity = '';
                btnEl.style.pointerEvents = '';
                btnEl.classList.remove('slide-out', 'slide-back');

                // Если диалог уже удалён (внешний overlay сработал раньше),
                // а кнопка всё ещё на body — просто убираем её
                if (btnEl.parentNode === document.body) {
                    btnEl.remove();
                }

                if (forestPanel) {
                    forestPanel.remove();
                    forestPanel = null;
                }
                var clone = document.getElementById('tm-forest-panel-clone');
                if (clone) clone.remove();
            };
            // Панель Forest будет закрыта в главном обработчике overlay
        });

        // ── Кнопка 💾 Сохранить ──────────────────────────────────────
        document.getElementById('tm-btn-save-all').addEventListener('click', function() {
            const tpls = getTemplates();
            const listEl = document.getElementById('tm-template-list');
            tpls.forEach(function(t, i) {
                const nameInput = document.getElementById('tm-name-' + i);
                const textInput = document.getElementById('tm-text-' + i);
                if (nameInput) t.name = nameInput.value.trim() || 'Шаблон ' + (i + 1);
                if (textInput) t.text = textInput.value;
            });
            saveTemplates(tpls);
            updateFormTemplates();
            menu.remove();
            overlay.remove();
        });

        // Закрытие по клику на overlay — с сохранением и закрытием Forest-панели
        overlay.addEventListener('click', function() {
            // Закрываем Forest-панель, если открыта
            if (forestPanel) {
                var _btnEl = document.getElementById('tm-btn-forest-msg');
                if (_btnEl && _btnEl.parentNode === document.body) _btnEl.remove();
                forestPanel.remove();
                forestPanel = null;
                var _ph = document.getElementById('tm-forest-placeholder');
                if (_ph) _ph.remove();
                var _cl = document.getElementById('tm-forest-panel-clone');
                if (_cl) _cl.remove();
            }
            // Сохраняем данные шаблонов
            const tpls = getTemplates();
            const listEl = document.getElementById('tm-template-list');
            tpls.forEach(function(t, i) {
                const nameInput = document.getElementById('tm-name-' + i);
                const textInput = document.getElementById('tm-text-' + i);
                if (nameInput) t.name = nameInput.value.trim() || 'Шаблон ' + (i + 1);
                if (textInput) t.text = textInput.value;
            });
            saveTemplates(tpls);
            updateFormTemplates();
            menu.remove();
            overlay.remove();
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Обновить блок шаблонов в форме (после редактирования)
    function updateFormTemplates() {
        const block = document.querySelector('.tm-templates-block');
        if (!block) return;
        const linksWrap = block.querySelector('div:last-child');
        if (!linksWrap) return;

        const templates = getTemplates();
        const textarea = findMessageField();
        if (!textarea) return;

        linksWrap.innerHTML = '';
        templates.forEach(function(tpl) {
            const link = document.createElement('a');
            link.href = '#';
            link.style.cssText = 'font-size: 13px; padding: 4px 10px; background: #fff; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; color: #333; text-decoration: none; display: flex; gap: 10px;';
            link.title = tpl.text.replace(/\\n/g, '\n');

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight: bold; white-space: nowrap; flex-shrink: 0; min-width: 110px;';
            nameSpan.textContent = tpl.name;

            const textSpan = document.createElement('span');
            textSpan.style.cssText = 'color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: 12px;';
            // первая строка текста, обрезаем (нормализуем \n → newline)
            const firstLine = tpl.text.replace(/\\n/g, '\n').split('\n')[0] || '';
            textSpan.textContent = firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;

            link.appendChild(nameSpan);
            link.appendChild(textSpan);

            link.addEventListener('click', function(e) {
                e.preventDefault();
                insertTemplate(textarea, tpl.text);
            });

            linksWrap.appendChild(link);
        });
    }

    // ==================================================================
    //  POLLING + MutationObserver
    // ==================================================================
    function waitForToolbar() {
        var _toolbarTries = 0;
        function check() {
            if (addSettingsButton()) return;
            _toolbarTries++;
            if (_toolbarTries > 120) {
                console.warn('[TM] ⏱ Кнопка «Копировать менеджерам» не найдена (таймаут 60с)');
                return;
            }
            setTimeout(check, 500);
        }
        check();
    }

    function waitForForm() {
        // Быстрый poll на случай если форма уже открыта
        function check() {
            if (document.querySelector('.tm-templates-block')) return;
            addTemplatesToForm();
            setTimeout(check, 800);
        }
        check();

        // MutationObserver — ловит момент когда textarea появляется в DOM
        // (решает проблему на Yandex где форма может грузиться с задержкой)
        var observer = new MutationObserver(function() {
            if (document.querySelector('.tm-templates-block')) {
                observer.disconnect();
                return;
            }
            if (findMessageField()) {
                addTemplatesToForm();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ==================================================================
    //  ТРЕКЕР ТТ — запоминаем ID текущего тикета и договора
    // ==================================================================
    var currentTTId = null;
    var currentContractId = null;
    var ttEnteredLogged = false;

    // ── Флаг: API-запрос уже выполняется ─────────────────────────────
    var contractApiPending = false;

    // ── Флаг: авто-парсер уже запущен ────────────────────────────────
    var _parserAutoRunning = false;

    // ── Запуск PON-парсера через прямые API-запросы (без вкладки!) ──
    function _parserStart(contractNum, login) {
        if (!contractNum) return;
        if (_parserAutoRunning) { console.log('[TM] Парсер уже запущен, пропускаю'); return; }
        _parserAutoRunning = true;
        contractNum = String(contractNum).replace(/[РP]\s*$/, '').trim();
        if (!contractNum) { _parserAutoRunning = false; return; }
        var _t0 = performance.now();
        var _triedLogin = false;
        console.log('[TM] Парсер ⏱ === СТАРТ для #' + contractNum + (login ? ' / login=' + login : '') + ' (без вкладки) ===');

        // ── 1. GET CSRF ──────────────────────────────────────────
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://forest.timernet.ru/technical-support/network/index?tab=pon-parser',
            onload: function(r1) {
                var csrfMatch = r1.responseText.match(/<input[^>]+name="_csrf-forest"[^>]+value="([^"]+)"/)
                    || r1.responseText.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
                if (!csrfMatch) { console.log('[TM] Парсер ❌ CSRF нет'); _parserAutoRunning = false; return; }
                var csrf = csrfMatch[1];
                console.log('[TM] Парсер CSRF за ' + (performance.now() - _t0).toFixed(0) + 'мс');

                // ── 2. Пробуем договор ────────────────────────────
                _searchAndDiag(contractNum, function(found) {
                    if (!found && login) {
                        _triedLogin = true;
                        console.log('[TM] Парсер договор пусто, пробую логин...');
                        _searchAndDiag(login, function(found2) {
                            if (!found2) _finish(null);
                        });
                    } else if (!found) {
                        _finish(null);
                    }
                });

                function _searchAndDiag(query, cb) {
                    var body = '_csrf-forest=' + encodeURIComponent(csrf)
                        + '&PonParserSearch%5BoltIp%5D=&PonParserSearch%5Bdognum%5D=' + encodeURIComponent(query)
                        + '&PonParserSearch%5Bonuserial%5D=&PonParserSearch%5Bdescr%5D=&_pjax=%23pjax-grid-container';
                    GM_xmlhttpRequest({
                        method: 'POST', url: 'https://forest.timernet.ru/technical-support/pon-parser/list',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: body,
                        onload: function(r) {
                            var m = r.responseText.match(/id="diag_(\d+)"/);
                            if (m) {
                                GM_xmlhttpRequest({
                                    method: 'GET', url: 'https://forest.timernet.ru/technical-support/pon-parser/diag?id=' + m[1],
                                    onload: function(r2) {
                                        var text = _parseDiagTable(r2.responseText);
                                        if (query !== contractNum) {
                                            text = '⚠️ Поиск был выполнен по логину! Сверяйте адрес.\n\n' + text;
                                        }
                                        if (currentTTId) GM_setValue('tm_parser_tt_' + currentTTId, text);
                                        console.log('[TM] Парсер ✅ (' + (performance.now() - _t0).toFixed(0) + 'мс)');
                                        _parserAutoRunning = false;
                                        if (cb) cb(true);
                                    },
                                    onerror: function() { _finish(null); }
                                });
                            } else {
                                if (cb) cb(false);
                            }
                        },
                        onerror: function() { if (cb) cb(false); }
                    });
                }

                function _finish() {
                    var txt = 'Нет данных в PON-парсере (договор: ' + contractNum + (_triedLogin && login ? ', логин: ' + login : '') + ').';
                    if (currentTTId) GM_setValue('tm_parser_tt_' + currentTTId, txt);
                    console.log('[TM] Парсер нет данных');
                    _parserAutoRunning = false;
                }
            },
            onerror: function() { console.log('[TM] Парсер ❌ ошибка страницы'); _parserAutoRunning = false; }
        });
    }

    // ── Парсинг HTML-таблицы диагностики в текст ──────────────────────
    function _parseDiagTable(html) {
        // Ищем все строки <tr> внутри <table> с классом table-bordered
        var rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
        var cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        var lines = [];
        var rowMatch;
        while ((rowMatch = rowRegex.exec(html)) !== null) {
            var cells = [];
            var cellMatch;
            while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
            }
            if (cells.length >= 2) {
                lines.push(cells[0] + '\t' + cells[1]);
            } else if (cells.length === 1) {
                lines.push(cells[0]);
            }
        }
        return lines.join('\n') || 'Нет данных';
    }

    // ── Показать результат парсера в модалке ──────────────────────────
    function _parserShowResult(text) {
        // ── Удаляем предыдущую модалку, если была ───────────────
        var oldModal = document.getElementById('tm-parser-modal');
        if (oldModal) oldModal.remove();

        // ── Строим модалку через createElement (без innerHTML) ──
        var modal = document.createElement('div');
        modal.id = 'tm-parser-modal';
        var w = Math.min(800, window.innerWidth - 40);
        var h = Math.min(500, window.innerHeight - 80);
        var x = Math.round((window.innerWidth - w) / 2);
        var y = Math.round((window.innerHeight - h) / 2);
        modal.style.cssText = 'position:fixed; left:' + x + 'px; top:' + y + 'px; width:' + w + 'px; height:' + h + 'px; z-index:999999; background:#fff; border:2px solid #0d6efd; border-radius:12px; padding:0; box-shadow:0 8px 32px rgba(0,0,0,0.3); display:flex; flex-direction:column; overflow:hidden; resize:both;';

        // Header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 16px; border-bottom:1px solid #dee2e6; cursor:grab; user-select:none; background:#f0f4ff; border-radius:12px 12px 0 0; flex-shrink:0;';
        var title = document.createElement('span');
        title.textContent = '🔍 Результат диагностики PON';
        title.style.cssText = 'font-size:15px; font-weight:600; color:#0d6efd; font-family:sans-serif;';
        header.appendChild(title);
        // Close btn
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:#dc3545; color:#fff; border:none; border-radius:6px; padding:3px 10px; cursor:pointer; font-size:14px;';
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // Body
        var body = document.createElement('div');
        body.style.cssText = 'flex:1; padding:12px 16px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-family:monospace; font-size:13px;';
        body.textContent = text;
        modal.appendChild(body);

        document.body.appendChild(modal);

        // ── Drag с авто-очисткой слушателей ───────────────────
        var _dx, _dy, _dragging = false;
        function _onMouseMove(e) {
            if (!_dragging) return;
            modal.style.left = Math.max(0, e.clientX - _dx) + 'px';
            modal.style.top = Math.max(0, e.clientY - _dy) + 'px';
        }
        function _onMouseUp() {
            if (_dragging) { _dragging = false; header.style.cursor = 'grab'; }
        }
        function _onKeyDown(e) {
            if (e.key === 'Escape' && modal.parentNode) _removeParserModal();
        }
        function _removeParserModal() {
            document.removeEventListener('mousemove', _onMouseMove);
            document.removeEventListener('mouseup', _onMouseUp);
            document.removeEventListener('keydown', _onKeyDown);
            if (modal.parentNode) modal.remove();
        }

        header.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            _dragging = true;
            _dx = e.clientX - modal.offsetLeft;
            _dy = e.clientY - modal.offsetTop;
            header.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', _onMouseMove);
        document.addEventListener('mouseup', _onMouseUp);

        // ── Close ───────────────────────────────────────────────
        closeBtn.addEventListener('click', _removeParserModal);
        document.addEventListener('keydown', _onKeyDown);
    }

    // ═════════════════════════════════════════════════════════════════
    //  ФОНОВОЕ СОЗДАНИЕ ТТ НА FOREST ЧЕРЕЗ API (без открытия вкладки)
    // ═════════════════════════════════════════════════════════════════

    function createTTInBackground(descText, solText, dogNum, vgId) {
        console.log('[TM] 🌳 Фоновый режим: создаю ТТ через API...');

        // GET CSRF
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://forest.timernet.ru/service-desk/tt/create',
            onload: function(r1) {
                var csrf = (r1.responseText.match(/<input[^>]+name="_csrf-forest"[^>]+value="([^"]+)"/)
                    || r1.responseText.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/));
                if (!csrf) { showBackgroundResult(null, descText, solText, '—', 'CSRF не найден', dogNum); return; }
                csrf = csrf[1];

                // POST
                var postBody = '_csrf-forest=' + encodeURIComponent(csrf)
                    + '&TtModel[source_change]=0&TtModel[source]=0&TtModel[action]=14&TtModel[priority]=1'
                    + '&TtModel[opendt]=' + Math.floor(Date.now() / 1000)
                    + '&TtModel[vg_id]=' + encodeURIComponent(String(vgId || dogNum))
                    + '&TtModel[phone_external]=7&TtModel[phone_contact]=7'
                    + '&TtModel[message]=' + encodeURIComponent(descText)
                    + '&TtModel[state]=1'
                    + '&TtModel[message_solution]=' + encodeURIComponent(solText)
                    + '&TtModel[open_new_tab]=0';

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://forest.timernet.ru/service-desk/tt/create',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    data: postBody,
                    onload: function(resp) {
                        var isSuccess = false;
                        var respText = (resp.responseText || '').substring(0, 1500);

                        // 302 редирект → успех
                        if (resp.status === 302) isSuccess = true;
                        // 200 без ошибок валидации → успех
                        if (resp.responseText && resp.responseText.indexOf('has-error') === -1
                            && resp.responseText.indexOf('help-block') === -1) {
                            isSuccess = true;
                        }

                        // В ответ показываем только статус и размер
                        var _respBrief = 'HTTP ' + resp.status + ', размер ' + (resp.responseText || '').length + 'б'
                            + (isSuccess ? ' — форма создания исчезла, ТТ создана' : '');

                        showBackgroundResult(
                            isSuccess ? 'создан' : null,
                            descText, solText,
                            postBody,
                            _respBrief,
                            dogNum
                        );
                    },
                    onerror: function() {
                        showBackgroundResult(null, descText, solText, postBody, 'Ошибка сети', dogNum);
                    }
                });
            },
            onerror: function() {
                showBackgroundResult(null, descText, solText, '—', 'Ошибка загрузки страницы Forest', dogNum);
            }
        });
    }

    function showBackgroundResult(ttNum, descText, solText, requestBody, responseText, dogNum) {
        var isSuccess = ttNum && String(ttNum) === 'создан';
        var text = isSuccess ? '✅ ТТ создан' : '❌ Ошибка создания ТТ';
        var bg = isSuccess ? 'rgba(5,150,105,0.95)' : 'rgba(220,38,38,0.95)';

        var el = document.createElement('div');
        el.id = 'tm-bg-result';
        el.textContent = text;
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;'
            + 'background:' + bg + ';color:#fff;padding:24px 40px;border-radius:16px;'
            + 'font-size:20px;font-weight:600;font-family:Arial,sans-serif;'
            + 'box-shadow:0 8px 40px rgba(0,0,0,0.25);text-align:center;opacity:0.85;'
            + 'transition:opacity 0.5s ease;';

        document.body.appendChild(el);

        setTimeout(function() {
            el.style.opacity = '0';
            setTimeout(function() { if (el.parentNode) el.remove(); }, 500);
        }, 3000);
    }

    // ── API: асинхронно получаем договор через userHelpdesk ──────────
    // Результат сохраняется напрямую в GM_setValue по готовности
    function startAsyncContractSearch(authorId) {
        if (!authorId || contractApiPending) return;
        contractApiPending = true;
        var _tApi = performance.now();
        var url = '/api.php/api/userHelpdesk?_dc=' + Date.now() + '&id=' + authorId + '&page=1&start=0&limit=100';
        console.log('[TM] 📡 Асинхронный запрос договора через API...');
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload: function(resp) {
                console.log('[TM] 📡 ⏱ Ответ API за ' + (performance.now() - _tApi).toFixed(0) + 'мс');
                try {
                    var data = JSON.parse(resp.responseText);
                    if (data.success && data.results && data.results.length > 0) {
                        // Ищем первый договор без "Р" в конце (активный)
                        var clientData = null;
                        var contractNum = null;
                        for (var ri = 0; ri < data.results.length; ri++) {
                            var r = data.results[ri];
                            var cn = r.agrm_num;
                            if (cn && !/[РP]$/.test(cn)) {
                                clientData = r;
                                contractNum = cn;
                                break;
                            }
                        }
                        // Если все с "Р" — берём первый
                        if (!clientData) {
                            clientData = data.results[0];
                            contractNum = clientData.agrm_num;
                        }
                        if (contractNum) {
                            console.log('[TM] ✅📄 Договор #' + contractNum + ' получен через API' + (/\d+Р$/.test(contractNum) ? ' (все с Р)' : ''));
                            // Сохраняем сразу (следующий цикл подхватит)
                            currentContractId = contractNum;
                            // Авто-запуск PON-парсера (пока пользователь читает ТТ)
                            _parserStart(contractNum, clientData.login);
                            GM_setValue('tm_forest_dog_num', contractNum);
                            GM_setValue('tm_forest_dog_ts', '' + Date.now());
                            GM_setValue('tm_forest_parser_login', clientData.login || '');
                            // Сохраняем полные данные клиента для select2 на Forest
                            GM_setValue('tm_forest_client_data', JSON.stringify({
                                id: String(clientData.vg_id),
                                text: contractNum,
                                vg_id: clientData.vg_id,
                                agrm_num: clientData.agrm_num,
                                login: clientData.login,
                                user_name: clientData.user_name,
                                addresses: clientData.addresses,
                                balance: clientData.balance,
                                tar_name: clientData.tar_name,
                                agent_name: clientData.agent_name,
                                block_text: 'уч. запись активна',
                                blocked: clientData.blocked,
                                symbol: clientData.symbol
                            }));
                            GM_setValue('tm_forest_dog_ts', '' + Date.now());
                        } else {
                            console.log('[TM] ⚠️ agrm_num пустой в ответе API');
                        }
                    } else {
                        console.log('[TM] ⚠️ Нет данных в ответе API');
                    }
                } catch(e) {
                    console.log('[TM] ❌ Ошибка парсинга API:', e.message);
                }
                contractApiPending = false;
            },
            onerror: function(err) {
                console.log('[TM] ❌ Ошибка запроса API');
                contractApiPending = false;
            }
        });
    }

    // ── Поиск author_id в ExtJS store ────────────────────────────────
    function findAuthorIdFromStore() {
        var pageExt = (typeof unsafeWindow !== 'undefined') ? unsafeWindow.Ext : null;
        if (!pageExt) return null;
        try {
            var grids = pageExt.ComponentQuery.query('grid');
            for (var g = 0; g < grids.length; g++) {
                try {
                    var store = grids[g].getStore();
                    if (!store || !store.getCount()) continue;
                    var foundId = null;
                    store.each(function(record) {
                        var data = record.getData();
                        if (String(data.ticket_id) === String(currentTTId)) {
                            foundId = data.author_id;
                            return false;
                        }
                    });
                    if (foundId) {
                        console.log('[TM] author_id найден:', foundId);
                        return foundId;
                    }
                } catch(e) {}
            }
        } catch(e) {}
        return null;
    }

    // Поиск номера договора в деталях открытого ТТ
    function findCurrentContract() {
        // ── ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ──────────────────────────────
        console.log('[TM] 🔍 findCurrentContract():');
        console.log('[TM]   currentTTId=' + currentTTId);

        var gvAll = document.querySelectorAll('.x-grid-view');
        console.log('[TM]   Всего x-grid-view в DOM: ' + gvAll.length);
        for (var gvi = 0; gvi < gvAll.length; gvi++) {
            var gv = gvAll[gvi];
            var gvId = gv.id || '(без id)';
            var visible = gv.offsetParent !== null;
            var cells = gv.querySelectorAll('.x-grid-cell-inner');
            var texts = [];
            for (var ci = 0; ci < Math.min(cells.length, 12); ci++) {
                var t = cells[ci].textContent.trim().substring(0, 40);
                if (t) texts.push(t);
            }
            console.log('[TM]   grid-view#' + gvi + ' id=' + gvId + ' visible=' + visible + ' cells=' + cells.length + ' тексты=[' + texts.join(' | ') + ']');
        }

        var infoBtns = document.querySelectorAll('.x-ibtn-info');
        console.log('[TM]   x-ibtn-info в DOM: ' + infoBtns.length);

        // ── ПОИСК ──────────────────────────────────────────────
        // Проверка строки на расторгнутый договор
        function _isContractActive(rowEl) {
            if (!rowEl) return true;
            var texts = rowEl.textContent || '';
            return texts.indexOf('pay-off') === -1
                && texts.indexOf('Расторг') === -1
                && texts.indexOf('расторг') === -1
                && !/Р\s*$/.test(texts.trim()); // "12345678Р" в конце
        }

        // Метод 1: DOM — по всем видимым x-grid-view, с учётом активности
        var bestCandidate = null;
        var bestScore = -1;

        var gridViews = document.querySelectorAll('.x-grid-view:not(.x-hidden)');
        for (var gv = 0; gv < gridViews.length; gv++) {
            var cells = gridViews[gv].querySelectorAll('.x-grid-cell-inner');
            for (var c = 0; c < cells.length; c++) {
                var txt = cells[c].textContent.trim();
                if (!/^\d{8}$/.test(txt)) continue;
                if (txt === currentTTId) continue;

                var row = cells[c].closest('.x-grid-row, .x-grid-item, tr');
                if (!_isContractActive(row)) {
                    console.log('[TM] 🚫 Договор #' + txt + ' пропущен (расторгнут)');
                    continue;
                }
                var rowCells = row ? row.querySelectorAll('.x-grid-cell-inner') : [];
                var score = 0;
                for (var rc = 0; rc < rowCells.length; rc++) {
                    var rt = rowCells[rc].textContent.trim();
                    if (rt.indexOf('руб') !== -1 || rt.indexOf('р.') !== -1) score += 100;
                    if (rt.indexOf('Активен') !== -1) score += 50;
                    if (rt.indexOf(',') !== -1 && rt.length > 20) score += 10;
                }
                if (score > bestScore) { bestScore = score; bestCandidate = txt; }
                if (bestCandidate === null) bestCandidate = txt;
            }
        }

        if (bestCandidate && bestScore > 0) {
            console.log('[TM] ✅📄 Найден договор #' + bestCandidate + ' (DOM, score=' + bestScore + ')');
            return bestCandidate;
        }

        // Метод 2: Кнопка x-ibtn-info
        for (var i = 0; i < infoBtns.length; i++) {
            var btn = infoBtns[i];
            if (btn.offsetParent === null) continue;
            var row = btn.closest('.x-grid-row, tr, .x-grid-data-row, .x-grid-item');
            if (!row || !_isContractActive(row)) continue;
            var cells = row.querySelectorAll('.x-grid-cell-inner');
            for (var c = 0; c < cells.length; c++) {
                var txt = cells[c].textContent.trim();
                if (/^\d{8}$/.test(txt) && txt !== currentTTId) {
                    console.log('[TM] ✅📄 Найден договор #' + txt + ' (рядом с кнопкой)');
                    return txt;
                }
            }
        }

        // Метод 3: Глобальное сканирование DOM — фильтруем расторгнутые
        var cellsAll = document.querySelectorAll('.x-grid-cell-inner');
        var candidates = [];
        for (var c = 0; c < cellsAll.length; c++) {
            var txt = cellsAll[c].textContent.trim();
            if (!/^\d{8}$/.test(txt) || txt === currentTTId) continue;
            var row = cellsAll[c].closest('.x-grid-row, .x-grid-item, tr');
            if (!_isContractActive(row)) continue;
            candidates.push(txt);
        }
        if (candidates.length === 1) {
            console.log('[TM] ✅📄 Найден договор #' + candidates[0] + ' (глобальный DOM)');
            return candidates[0];
        }
        if (candidates.length > 1) {
            console.log('[TM] 📄 Первый кандидат #' + candidates[0] + ' (из ' + candidates.length + ')');
            return candidates[0];
        }

        console.log('[TM] ❌ Договор не найден');
        return null;
    }

    // ── Перехват XHR для отладки: логируем запросы и ответы при клике на info-кнопку ──
    document.addEventListener('click', function(e) {
        var infoBtn = e.target.closest('.x-ibtn-info');
        if (!infoBtn) return;
        console.log('[TM] 👆 КЛИК по x-ibtn-info! Перехватываю XHR+ответы на 15 сек...');

        var pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        var XHR = pageWindow.XMLHttpRequest;
        if (!XHR) { console.log('[TM] Нет доступа к XMLHttpRequest страницы'); return; }

        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;

        XHR.prototype.open = function(method, url) {
            this._tm_url = (typeof url === 'string') ? url : (url + '');
            this._tm_method = method;
            console.log('[TM]   ▶ XHR:', method, (this._tm_url || '').substring(0, 300));
            return origOpen.apply(this, arguments);
        };

        XHR.prototype.send = function(body) {
            var xhr = this;
            // Вешаем обработчик загрузки
            var origOnload = xhr.onload;
            xhr.onload = function() {
                var url = xhr._tm_url || '';
                if (url.indexOf('userHelpdesk') !== -1 || url.indexOf('agreement') !== -1 || url.indexOf('contract') !== -1 || url.indexOf('dog') !== -1 || url.indexOf('info') !== -1) {
                    try {
                        var respText = xhr.responseText ? xhr.responseText.substring(0, 2000) : '(пусто)';
                        console.log('[TM]   ⬅ ОТВЕТ для ' + url.substring(0, 100) + ':');
                        console.log('[TM]   ⬅ ' + respText);
                        // Если в ответе есть 8-значное число — сохраняем
                        var match = respText.match(/"\d{8}"/);
                        if (match) {
                            console.log('[TM] 🎯 Найден потенциальный договор в ответе:', match[0]);
                        }
                    } catch(e) {
                        console.log('[TM]   ⬅ Ошибка чтения ответа:', e.message);
                    }
                }
                if (origOnload) origOnload.call(xhr, arguments);
            };
            return origSend.apply(this, arguments);
        };

        setTimeout(function() {
            XHR.prototype.open = origOpen;
            XHR.prototype.send = origSend;
            console.log('[TM] XHR hook снят');
        }, 15000);
    }, true);

    // Ловим клик по заголовку тикета → запоминаем ID
    document.addEventListener('click', function(e) {
        var title = e.target.closest('.incident-title-grid-cell');
        if (!title) return;
        var row = title.closest('.x-grid-row, tr, .x-grid-data-row');
        if (!row) return;
        var cells = row.querySelectorAll('.x-grid-cell-inner');
        for (var ci = 0; ci < cells.length; ci++) {
            var txt = cells[ci].textContent.trim();
            if (/^\d{3,}$/.test(txt) && txt.length >= 3 && txt.length <= 8) {
                currentTTId = txt;
                currentContractId = null;
                ttEnteredLogged = false;
                contractSearchActive = true;
                // Сброс авто-парсера при переключении ТТ
                _parserAutoRunning = false;
                console.log('[TM] 🖱 Клик по ТТ #' + txt);
                return;
            }
        }
    }, true);

    // Поиск договора (бесконечный, пока ТТ открыт)
    var contractSearchActive = false;
    var _contractSearchTimer = null; // тайминг поиска

    // Следим за выбором ТТ и сразу начинаем искать договор
    setInterval(function() {
        var ta = document.querySelector('textarea[name="text"]');
        var hasForm = ta !== null && ta.offsetParent !== null;

        // ── Вошли в новый ТТ ──────────────────────────────────
        if (hasForm && currentTTId && !ttEnteredLogged) {
            ttEnteredLogged = true;
            var savedDog = GM_getValue('tm_forest_dog_num');
            if (savedDog) {
                currentContractId = savedDog;
                console.log('[TM] ✅📄 Договор #' + savedDog + ' восстановлен из сохранённого');
            } else {
                console.log('[TM] ➡ Вошли в ТТ #' + currentTTId + ' — ищу договор...');
            }
            contractSearchActive = true;
        }

        // ── Ищем договор СРАЗУ (не ждём textarea) ────────────
        // Как только стал известен currentTTId — начинаем поиск.
        // Не ждём появления формы (hasForm), author_id можно
        // получить из ExtJS store в любом состоянии.
        if (currentTTId && !currentContractId && contractSearchActive && !contractApiPending) {
            // Сначала пробуем DOM — если форма видна
            var contractNum = null;
            if (hasForm) {
                contractNum = findCurrentContract();
            }
            if (contractNum) {
                currentContractId = contractNum;
                contractSearchActive = false;
                _contractSearchTimer = null;
                GM_setValue('tm_forest_dog_num', contractNum);
                GM_setValue('tm_forest_dog_ts', '' + Date.now());
                console.log('[TM] ✅📄 Договор #' + contractNum + ' найден в DOM');
            } else {
                // DOM пуст или форма невидима — сразу в API
                _contractSearchTimer = _contractSearchTimer || Date.now();
                console.log('[TM] 📡 Ищу author_id в store для API...');
                var authorId = findAuthorIdFromStore();
                if (authorId) {
                    console.log('[TM] 📡 author_id=' + authorId + ' → старт API (прошло ' + (Date.now() - _contractSearchTimer) + 'мс от входа в ТТ)');
                    startAsyncContractSearch(authorId);
                } else {
                    // store ещё не подгрузился — повторим на следующем тике
                }
            }
        }
    }, 500);

    // ==================================================================
    //  СТАРТ
    // ==================================================================
    if (document.readyState === 'complete') {
        waitForToolbar();
        waitForForm();
    } else {
        window.addEventListener('load', function() {
            waitForToolbar();
            waitForForm();
        });
    }

})();
