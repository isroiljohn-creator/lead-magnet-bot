require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const { db, getSetting, setSetting } = require('./database');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

bot.use(session());
bot.use((ctx, next) => {
    ctx.session = ctx.session || {};
    return next();
});

const isAdmin = (ctx) => ctx.from && ctx.from.id.toString() === ADMIN_ID;

// USER LOGIC
const showMainMenu = (ctx) => {
    return ctx.reply("Asosiy menyu:", Markup.keyboard([
        ["🎁 Bepul darslar"]
    ]).resize());
};

bot.start((ctx) => {
    ctx.session = {};
    const user = ctx.from;
    const exists = db.prepare('SELECT phone_number FROM users WHERE telegram_id = ?').get(user.id.toString());
    
    if (exists && exists.phone_number) {
        return showMainMenu(ctx);
    }

    ctx.reply(
        `Assalomu alaykum, ${ctx.from.first_name}! Bepul darslarni olish uchun quyidagi tugma orqali telefon raqamingizni yuboring.`,
        Markup.keyboard([
            Markup.button.contactRequest('📱 Raqamni yuborish')
        ]).resize().oneTime()
    );
});

bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    const user = ctx.from;
    
    const exists = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(user.id.toString());
    if (!exists) {
        db.prepare(`INSERT INTO users (telegram_id, first_name, username, phone_number) VALUES (?, ?, ?, ?)`).run(user.id.toString(), user.first_name || '', user.username || '', contact.phone_number);
    } else {
        db.prepare('UPDATE users SET phone_number = ? WHERE telegram_id = ?').run(contact.phone_number, user.id.toString());
    }

    await ctx.reply('✅ Raqamingiz qabul qilindi!', Markup.removeKeyboard());
    return showMainMenu(ctx);
});

bot.hears("🎁 Bepul darslar", async (ctx) => {
    const user = ctx.from;
    const exists = db.prepare('SELECT phone_number FROM users WHERE telegram_id = ?').get(user.id.toString());
    if (!exists || !exists.phone_number) {
        return ctx.reply("Iltimos, avval /start buyrug'ini bosib ro'yxatdan o'ting.");
    }

    const lessons = db.prepare('SELECT id, title FROM lessons').all();
    if (lessons.length === 0) {
        return ctx.reply("Hozircha darslar mavjud emas.");
    }

    const buttons = lessons.map(l => [Markup.button.callback(`📖 ${l.title}`, `view_lesson_${l.id}`)]);
    
    await ctx.reply("O'zingizga kerakli darsni tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/view_lesson_(\d+)/, async (ctx) => {
    const lessonId = ctx.match[1];
    const user = ctx.from;
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    
    if (!lesson) {
        return ctx.answerCbQuery("Dars topilmadi", { show_alert: true });
    }

    // Log the view
    db.prepare(`INSERT INTO lesson_views (telegram_id, lesson_id) VALUES (?, ?)`).run(user.id.toString(), lessonId);

    const inlineKeyboard = Markup.inlineKeyboard([
        Markup.button.url(lesson.button_text || "▶️ Darsni ko'rish", lesson.link || "https://t.me")
    ]);

    if (lesson.file_id) {
        await ctx.replyWithPhoto(lesson.file_id, { 
            caption: lesson.text || lesson.title,
            ...inlineKeyboard
        });
    } else {
        await ctx.reply(lesson.text || lesson.title, {
            ...inlineKeyboard
        });
    }
    ctx.answerCbQuery();
});

// ADMIN LOGIC
bot.command('admin', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = null;
    ctx.reply('👨‍💻 Admin panelga xush kelibsiz!', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Bazani Excel qilib olish', 'export_excel')],
        [Markup.button.callback('📢 Xabar yuborish (Rassilka)', 'start_broadcast')],
        [Markup.button.callback("📚 Darslarni boshqarish", 'manage_lessons')],
        [Markup.button.callback("📈 Statistika", 'show_statistics')],
        [Markup.button.callback('❌ Bekor qilish', 'cancel_admin')]
    ]));
});

bot.action('manage_lessons', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = null;
    
    const lessons = db.prepare('SELECT * FROM lessons').all();
    const buttons = lessons.map(l => [Markup.button.callback(`📖 ${l.title}`, `edit_lesson_${l.id}`)]);
    buttons.push([Markup.button.callback("➕ Yangi dars qo'shish", 'add_new_lesson')]);
    buttons.push([Markup.button.callback("🔙 Orqaga", 'admin_menu')]);
    
    ctx.editMessageText("📚 Darslarni boshqarish:", Markup.inlineKeyboard(buttons)).catch(()=>{});
    ctx.answerCbQuery();
});

bot.action('admin_menu', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = null;
    ctx.editMessageText('👨‍💻 Admin panelga xush kelibsiz!', Markup.inlineKeyboard([
        [Markup.button.callback('📊 Bazani Excel qilib olish', 'export_excel')],
        [Markup.button.callback('📢 Xabar yuborish (Rassilka)', 'start_broadcast')],
        [Markup.button.callback("📚 Darslarni boshqarish", 'manage_lessons')],
        [Markup.button.callback("📈 Statistika", 'show_statistics')],
        [Markup.button.callback('❌ Bekor qilish', 'cancel_admin')]
    ])).catch(()=>{});
});

bot.action('show_statistics', (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const uniqueViewers = db.prepare('SELECT COUNT(DISTINCT telegram_id) as count FROM lesson_views').get().count;
    const totalViews = db.prepare('SELECT COUNT(*) as count FROM lesson_views').get().count;
    
    const viewsPerLesson = db.prepare(`
        SELECT l.title, COUNT(v.id) as views
        FROM lessons l
        LEFT JOIN lesson_views v ON l.id = v.lesson_id
        GROUP BY l.id
    `).all();

    let statsMsg = `📈 **Bot Statistikasi:**\n\n`;
    statsMsg += `👥 Jami obunachilar: **${totalUsers} ta**\n`;
    statsMsg += `👁 Dars ko'rganlar: **${uniqueViewers} ta** (Noyob odamlar)\n`;
    statsMsg += `📊 Jami dars ko'rishlar soni: **${totalViews} marta**\n\n`;
    statsMsg += `📚 **Darslar bo'yicha ko'rishlar:**\n`;
    
    viewsPerLesson.forEach(item => {
        statsMsg += `- ${item.title}: **${item.views} marta**\n`;
    });

    ctx.editMessageText(statsMsg, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Orqaga", 'admin_menu')]]) 
    }).catch(()=>{});
    ctx.answerCbQuery();
});

bot.action('add_new_lesson', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = 'WAITING_FOR_NEW_LESSON_TITLE';
    ctx.reply("Yangi dars nomini yuboring (Masalan: 1-dars. Asoslar):");
    ctx.answerCbQuery();
});

bot.action(/edit_lesson_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const lessonId = ctx.match[1];
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    if (!lesson) return ctx.answerCbQuery("Dars topilmadi", { show_alert: true });

    await ctx.reply(`Dars tahriri: ${lesson.title}`);
    
    const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("✏️ Nomini", `set_title_${lesson.id}`), Markup.button.callback("🖼 Rasmni", `set_photo_${lesson.id}`)],
        [Markup.button.callback("📝 Matnni", `set_text_${lesson.id}`), Markup.button.callback("🔘 Tugmani", `set_btn_${lesson.id}`)],
        [Markup.button.callback("🔗 Havolani", `set_link_${lesson.id}`)],
        [Markup.button.callback("🗑 Darsni o'chirish", `del_lesson_${lesson.id}`)],
        [Markup.button.callback("🔙 Darslar ro'yxati", 'manage_lessons')]
    ]);

    if (lesson.file_id) {
        await ctx.replyWithPhoto(lesson.file_id, { caption: lesson.text || "Matn yo'q", ...inlineKeyboard });
    } else {
        await ctx.reply(lesson.text || "Matn yo'q", inlineKeyboard);
    }
    ctx.answerCbQuery();
});

const editActions = ['set_title', 'set_photo', 'set_text', 'set_btn', 'set_link'];
editActions.forEach(action => {
    bot.action(new RegExp(`${action}_(\\d+)`), (ctx) => {
        if (!isAdmin(ctx)) return;
        const lessonId = ctx.match[1];
        ctx.session.state = action;
        ctx.session.editLessonId = lessonId;
        
        const prompts = {
            'set_title': "Yangi nomni yuboring:",
            'set_photo': "Yangi rasmni yuboring (Agar rasmni o'chirmoqchi bo'lsangiz 'ochirish' deb yozing):",
            'set_text': "Yangi matnni yuboring:",
            'set_btn': "Tugma ustidagi yangi yozuvni yuboring:",
            'set_link': "Yangi havolani yuboring:"
        };
        ctx.reply(prompts[action]);
        ctx.answerCbQuery();
    });
});

bot.action(/del_lesson_(\d+)/, (ctx) => {
    if (!isAdmin(ctx)) return;
    const lessonId = ctx.match[1];
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    ctx.reply("✅ Dars o'chirildi!");
    ctx.answerCbQuery();
});

bot.action('export_excel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const users = db.prepare('SELECT id, telegram_id, first_name, username, phone_number, joined_at FROM users').all();
    if (users.length === 0) return ctx.answerCbQuery("Bazada hali foydalanuvchilar yo'q.", { show_alert: true });
    
    const worksheet = xlsx.utils.json_to_sheet(users);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Obunachilar");
    const filePath = path.join(__dirname, 'obunachilar.xlsx');
    xlsx.writeFile(workbook, filePath);
    await ctx.replyWithDocument({ source: filePath, filename: 'obunachilar.xlsx' });
    fs.unlinkSync(filePath);
    ctx.answerCbQuery();
});

bot.action('start_broadcast', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = 'WAITING_FOR_BROADCAST';
    ctx.reply("Iltimos, barcha obunachilarga yuboriladigan xabarni (matn, rasm, video va h.k.) shu yerga yuboring.\n\nBekor qilish uchun /cancel buyrug'ini bering.");
    ctx.answerCbQuery();
});

bot.action('cancel_admin', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = null;
    ctx.deleteMessage().catch(() => {});
    ctx.reply('Admin panel yopildi.');
    ctx.answerCbQuery();
});

bot.command('cancel', (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.state = null;
    ctx.reply('Jarayon bekor qilindi.');
});

bot.on('message', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const state = ctx.session.state;

    if (state === 'WAITING_FOR_BROADCAST') {
        ctx.session.state = null;
        const users = db.prepare('SELECT telegram_id FROM users').all();
        let successCount = 0; let failCount = 0;
        await ctx.reply(`Rassilka boshlandi... Jami: ${users.length} ta obunachi.`);
        for (const user of users) {
            try { await ctx.telegram.copyMessage(user.telegram_id, ctx.message.chat.id, ctx.message.message_id); successCount++; } catch (err) { failCount++; }
            await new Promise(r => setTimeout(r, 50));
        }
        ctx.reply(`✅ Rassilka tugadi!\nMuvaqqiyatli: ${successCount}\nXatolik/Bloklangan: ${failCount}`);
        return;
    }

    if (state === 'WAITING_FOR_NEW_LESSON_TITLE') {
        ctx.session.state = null;
        if (!ctx.message.text) return ctx.reply("Iltimos matn yuboring.");
        const info = db.prepare('INSERT INTO lessons (title, text, button_text, link) VALUES (?, ?, ?, ?)').run(ctx.message.text, "Yangi dars matni", "▶️ Ko'rish", "https://t.me");
        ctx.reply("✅ Yangi dars yaratildi! Endi uni ro'yxatdan topib, qolgan ma'lumotlarini o'zgartirishingiz mumkin. /admin ni bosing.");
        return;
    }

    if (editActions.includes(state)) {
        const lessonId = ctx.session.editLessonId;
        ctx.session.state = null;
        
        let field = '';
        let val = '';
        
        if (state === 'set_title') { field = 'title'; val = ctx.message.text; }
        else if (state === 'set_text') { field = 'text'; val = ctx.message.text || ctx.message.caption; }
        else if (state === 'set_btn') { field = 'button_text'; val = ctx.message.text; }
        else if (state === 'set_link') { field = 'link'; val = ctx.message.text; }
        else if (state === 'set_photo') { 
            field = 'file_id'; 
            if (ctx.message.photo) val = ctx.message.photo[ctx.message.photo.length - 1].file_id; 
            else if (ctx.message.text && ctx.message.text.toLowerCase() === 'ochirish') val = null;
            else return ctx.reply("Rasm yuboring yoki 'ochirish' deb yozing.");
        }

        if (field && val !== undefined) {
            db.prepare(`UPDATE lessons SET ${field} = ? WHERE id = ?`).run(val, lessonId);
            ctx.reply("✅ O'zgarish saqlandi! Yana tahrirlash uchun darslar ro'yxatiga qayting: /admin");
        }
        return;
    }

    return next();
});

bot.launch().then(() => console.log('Bot is running...')).catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
