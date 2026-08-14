const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const pino = require('pino');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const sessoesAdmin = {};

async function startBot() {
    console.log("🤖 ROBÔ LIGADO COM SUCESSO ✅");
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({ 
        logger: pino({ level: 'silent' }), 
        auth: state,
        browser: ['Ubuntu', 'Chrome', '122.0.6261.111']
    });

    sock.ev.on('creds.update', saveCreds);

    iniciarMonitorMacrodroid(sock);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        const mek = chatUpdate.messages[0];
        if (!mek.message || mek.key.fromMe) return;

        const sender = mek.key.remoteJid;
        const participante = mek.key.participant || sender; 
        const usuarioTag = `@${participante.split('@')[0]}`;
        const text = (mek.message.conversation || mek.message.extendedTextMessage?.text || mek.message.imageMessage?.caption || mek.message.documentMessage?.caption || "").trim();
        const isGroup = sender.endsWith('@g.us');

        const sendMention = async (mensagem) => {
            await sock.sendMessage(sender, { 
                text: `${mensagem}\n\n${usuarioTag}`, 
                mentions: [participante],
                contextInfo: { mentionedJid: [participante] }
            });
        };

        async function verificarAdmin(userJid) {
            if (!isGroup) return true;
            try {
                const metadata = await sock.groupMetadata(sender);
                const participant = metadata.participants.find(p => p.id === userJid);
                return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            } catch (err) {
                return false;
            }
        }

        // Fluxo interativo do .addcmd (se o admin estiver numa sessão ativa)
        if (sessoesAdmin[participante]) {
            const sessao = sessoesAdmin[participante];

            // Permitir fechar e ver o relatório a qualquer momento digitando .addfm
            if (text.trim() === '.addfm') {
                let relatorio = `📊 **RELATÓRIO DA SESSÃO (.addfm)**\n\n`;
                relatorio += `👤 **Admin:** ${usuarioTag}\n`;
                relatorio += `🕒 **Total de alterações:** ${sessao.acoesRealizadas.length}\n\n`;

                if (sessao.acoesRealizadas.length === 0) {
                    relatorio += `Nenhuma alteração efetuada.\n`;
                } else {
                    sessao.acoesRealizadas.forEach((ac, index) => {
                        if (ac.tipo === 'adicao') {
                            relatorio += `${index + 1}. ➕ **Adicionado:** \`${ac.comando}\`\n   Resp: ${ac.resposta}\n`;
                        } else if (ac.tipo === 'exclusao') {
                            relatorio += `${index + 1}. 🗑️ **Excluído:** \`${ac.comando}\`\n`;
                        }
                    });
                }

                await sock.sendMessage(sender, { text: relatorio, mentions: [participante] }, { quoted: mek });
                delete sessoesAdmin[participante];
                return;
            }

            if (sessao.step === 'escolher_acao') {
                if (text === '1') {
                    sessao.step = 'aguardar_novo_comando';
                    await sock.sendMessage(sender, { text: '➕ Envie o **nome do comando** que deseja adicionar (ex: `.regras`):\n\n*(Ou digite `.addfm` para encerrar e ver o relatório)*' }, { quoted: mek });
                    return;
                } else if (text === '2') {
                    sessao.step = 'aguardar_excluir_comando';
                    await sock.sendMessage(sender, { text: '🗑️ Envie o **nome do comando** que deseja excluir:\n\n*(Ou digite `.addfm` para encerrar e ver o relatório)*' }, { quoted: mek });
                    return;
                } else {
                    await sock.sendMessage(sender, { text: '⚠️ Opção inválida. Responda com **1** para adicionar ou **2** para excluir.' }, { quoted: mek });
                    return;
                }
            } else if (sessao.step === 'aguardar_novo_comando') {
                sessao.novoComando = text.toLowerCase();
                sessao.step = 'aguardar_resposta_comando';
                await sock.sendMessage(sender, { text: `💬 Agora envie a **resposta** que o bot deve dar quando usarem \`${sessao.novoComando}\`:` }, { quoted: mek });
                return;
            } else if (sessao.step === 'aguardar_resposta_comando') {
                const respostaComando = text;
                const cmdNome = sessao.novoComando;

                const { error } = await supabase.from('comandos_customizados').upsert([
                    { comando: cmdNome, resposta: respostaComando }
                ]);

                if (error) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao guardar o comando na base de dados.' }, { quoted: mek });
                } else {
                    sessao.acoesRealizadas.push({ tipo: 'adicao', comando: cmdNome, resposta: respostaComando });
                    
                    sessao.step = 'escolher_acao';
                    await sock.sendMessage(sender, { 
                        text: `✅ Comando \`${cmdNome}\` adicionado com sucesso!\n\n🛠️ **Gestão de Comandos**\nDeseja fazer mais alguma alteração?\n1️⃣ Quero adicionar outro comando\n2️⃣ Quero excluir\n\n*(Ou digite \`.addfm\` para ver o relatório final)*` 
                    }, { quoted: mek });
                }
                return;
            } else if (sessao.step === 'aguardar_excluir_comando') {
                const cmdExcluir = text.toLowerCase();

                const { error } = await supabase.from('comandos_customizados').delete().eq('comando', cmdExcluir);

                if (error) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao excluir o comando.' }, { quoted: mek });
                } else {
                    sessao.acoesRealizadas.push({ tipo: 'exclusao', comando: cmdExcluir });
                    
                    sessao.step = 'escolher_acao';
                    await sock.sendMessage(sender, { 
                        text: `🗑️ Comando \`${cmdExcluir}\` excluído com sucesso!\n\n🛠️ **Gestão de Comandos**\nDeseja fazer mais alguma alteração?\n1️⃣ Quero adicionar novo comando\n2️⃣ Quero excluir\n\n*(Ou digite \`.addfm\` para ver o relatório final)*` 
                    }, { quoted: mek });
                }
                return;
            }
        }

        if (isGroup) {
            const isAdmin = await verificarAdmin(participante);

            if (!isAdmin) {
                const contextInfo = mek.message.extendedTextMessage?.contextInfo || {};
                const mentions = contextInfo.mentionedJid || [];
                
                const mencionaGrupo = mentions.includes(sender) || 
                                     contextInfo.isGroupJidMentioned === true ||
                                     text.includes('Este grupo foi mencionado') ||
                                     text.includes('@g.us');

                if (mencionaGrupo) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        await sock.groupParticipantsUpdate(sender, [participante], "remove");
                        await sock.sendMessage(sender, { 
                            text: `❌ ${usuarioTag} foi removido(a) automaticamente por causa de mencionar o grupo!`,
                            mentions: [participante]
                        });
                    } catch (err) {
                        console.log("Erro ao aplicar moderação de menção ao grupo:", err);
                    }
                    return;
                }

                const regexLink = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][-a-zA-Z0-90-9]+\.(com|net|org|edu|gov|mil|br|pt|mz|info|io|me|tk|ml|ga|cf|gq)\b)/i;

                if (regexLink.test(text)) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        await sock.groupParticipantsUpdate(sender, [participante], "remove");
                        await sock.sendMessage(sender, { 
                            text: `❌ ${usuarioTag} foi removido(a) automaticamente por causa de mandar link e é proibido!`,
                            mentions: [participante]
                        });
                    } catch (err) {
                        console.log("Erro ao aplicar moderação de link:", err);
                    }
                    return;
                }
            }
        }

        if (text.startsWith('.')) {
            if (!isGroup) {
                await sock.sendMessage(sender, { text: '❌ Este comando só pode ser usado dentro de grupos.' }, { quoted: mek });
                return;
            }

            const isAdminGeral = await verificarAdmin(participante);
            if (!isAdminGeral) {
                await sock.sendMessage(sender, { text: '❌ Não tens permissão para usar este comando.' }, { quoted: mek });
                return;
            }

            const comandoInput = text.trim();

            if (comandoInput.startsWith('.ban')) {
                let alvoBan = mek.message.extendedTextMessage?.contextInfo?.participant;
                
                if (!alvoBan) {
                    const mentions = mek.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (mentions.length > 0) {
                        alvoBan = mentions[0];
                    }
                }

                if (!alvoBan) {
                    await sock.sendMessage(sender, { text: '⚠️ Responda à mensagem da pessoa ou mencione-a junto com `.ban` para removê-la.', quoted: mek });
                    return;
                }

                try {
                    await sock.groupParticipantsUpdate(sender, [alvoBan], "remove");
                    await sock.sendMessage(sender, { 
                        text: `🔨 O membro @${alvoBan.split('@')[0]} foi banido(a) do grupo por ordem de um administrador.`,
                        mentions: [alvoBan]
                    });
                } catch (err) {
                    await sock.sendMessage(sender, { text: `❌ Erro ao tentar banir o membro. Verifique se o bot possui privilégios de administrador.` }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.grupo f') {
                try {
                    await sock.groupSettingUpdate(sender, 'announcement');
                    await sock.sendMessage(sender, { text: '🤖 GRUPO FECHADO🔒' }, { quoted: mek });
                } catch (err) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao tentar fechar o grupo. Certifique-se de que o bot é administrador.' }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.grupo a') {
                try {
                    await sock.groupSettingUpdate(sender, 'not_announcement');
                    
                    const metadata = await sock.groupMetadata(sender);
                    const allParticipants = metadata.participants.map(p => p.id);

                    await sock.sendMessage(sender, { 
                        text: '🤖 GRUPO ABERTO 🔓',
                        mentions: allParticipants
                    });
                } catch (err) {
                    await sock.sendMessage(sender, { text: '❌ Erro ao tentar abrir o grupo. Certifique-se de que o bot é administrador.' }, { quoted: mek });
                }
                return;
            }

            if (comandoInput === '.addcmd') {
                sessoesAdmin[participante] = {
                    step: 'escolher_acao',
                    acoesRealizadas: []
                };

                await sock.sendMessage(sender, { 
                    text: '🛠️ **Gestão de Comandos**\n\nO que deseja fazer?\n1️⃣ Quero adicionar novo comando\n2️⃣ Quero excluir\n\n*(Responda com 1 ou 2)*' 
                }, { quoted: mek });
                return;
            }

            if (text.toLowerCase().startsWith('.comprar')) {
                const partes = text.trim().split(/\s+/);
                
                if (partes.length < 3) {
                    await sendMention(`❌ *Formato inválido!*\nUse: \`.comprar [pacote] [numero]\` ou \`.comprar [pacote] [numero] [referencia]\``);
                    return;
                }

                const pacoteSolicitado = partes[1].toLowerCase();
                const telefoneSolicitado = partes[2];
                
                if (!/^\d{9}$/.test(telefoneSolicitado) || !/^8[45]/.test(telefoneSolicitado)) {
                    await sendMention(`❌ *Número de telefone inválido!* Deve ter 9 dígitos e começar por 84 ou 85.`);
                    return;
                }

                let referenciaInformada = null;
                const refIndex = partes.findIndex(p => p.toLowerCase() === 'ref:' || p.toLowerCase() === 'ref');
                if (refIndex !== -1 && partes[refIndex + 1]) {
                    referenciaInformada = partes[refIndex + 1];
                } else if (partes.length >= 4 && !partes[3].toLowerCase().startsWith('ref')) {
                    referenciaInformada = partes[3];
                }

                let referenciaFinal = referenciaInformada;
                let transacaoReal = null;

                if (referenciaFinal) {
                    referenciaFinal = referenciaFinal.replace(/\.$/, "").trim();

                    const { data: txEncontrada } = await supabase
                        .from('transecoes_pendentes')
                        .select('*')
                        .eq('referencia', referenciaFinal)
                        .eq('status', 'pendente')
                        .maybeSingle();

                    transacaoReal = txEncontrada;

                    if (!transacaoReal) {
                        await sendMention(`❌ *Referência inválida ou já processada!* Verifique o código enviado.`);
                        return;
                    }
                } else {
                    referenciaFinal = 'ADM' + Date.now();
                }

                const { data: dadosPreco } = await supabase
                    .from('tabela_precos')
                    .select('*')
                    .ilike('megas', `%${pacoteSolicitado}%`)
                    .maybeSingle();

                const valorTransacao = dadosPreco?.valor || 0;
                const megasFinais = dadosPreco?.megas || partes[1].toUpperCase();

                if (transacaoReal) {
                    await supabase.from('transecoes_pendentes').update({ status: 'processado' }).eq('id', transacaoReal.id);
                } else {
                    await supabase.from('transecoes_pendentes').insert([{
                        referencia: referenciaFinal,
                        valor: valorTransacao,
                        status: 'processado'
                    }]).select();
                }

                await supabase.from('memoria_aguardando').insert([{
                    sender: participante,
                    valor: valorTransacao,
                    referencia: referenciaFinal,
                    status: 'usado',
                    usado_por: usuarioTag,
                    data_uso: new Date().toISOString()
                }]);

                await supabase.from('fila_macrodroid').insert([{
                    telefone: telefoneSolicitado,
                    pacote: megasFinais,
                    status: 'pendente',
                    sender: participante,
                    referencia: referenciaFinal
                }]);

                const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
                const msgSucessoComprar = `✅ *PEDIDO CRIADO COM SUCESSO!*\n\n💰 Referência: ${referenciaFinal}\n📊 Megas: ${megasFinais}\n📱 Número: ${telefoneSolicitado}\n📍 Grupo: Vendas de Megas\n\n🔄 Pedido registrado e aguardando processamento.\n⏰ ${dataHoraAtual}`;

                await sendMention(msgSucessoComprar);
                return;
            }

            return;
        }
if (text.includes("Confirmado") || text.includes("ID da transacao")) {
            let referencia = text.match(/(Confirmado|ID da transacao)[:\s]+([A-Z0-9.]+)/i)?.[2] || "N/A";
            referencia = referencia.replace(/\.$/, "").trim();

            let textoSemPara = text.replace(/para\s+(8[457]\d{7})/gi, 'REMOVIDO');
            let numerosEncontrados = textoSemPara.match(/\b(8[45]\s*\d{3}\s*\d{4}|8[45]\d{7})\b/g) || [];
            let numeroVodacom = null;

            if (numerosEncontrados.length > 0) {
                let ultimoNum = numerosEncontrados[numerosEncontrados.length - 1].replace(/\D/g, '');
                if (ultimoNum.startsWith('84') || ultimoNum.startsWith('85')) {
                    numeroVodacom = ultimoNum;
                }
            }

            const { data: jaUsado } = await supabase
                .from('memoria_aguardando')
                .select('*')
                .eq('referencia', referencia)
                .maybeSingle();
            
            if (jaUsado) {
                const dataFormatada = new Date(jaUsado.data_uso || Date.now()).toLocaleString('pt-PT');
                await sendMention(`❌ ${usuarioTag} *Comprovativo já utilizado!*\n\n👤 *Utilizado por:* ${jaUsado.usado_por || 'Desconhecido'}\n📅 *Data:* ${dataFormatada}\n\nEste comprovativo não pode ser processado novamente.`);
                return;
            }

            const { data: transacaoReal } = await supabase
                .from('transecoes_pendentes')
                .select('*')
                .eq('referencia', referencia)
                .eq('status', 'pendente')
                .maybeSingle();

            if (!transacaoReal) {
                await sendMention(`❌ *COMPROVATIVO INVÁLIDO OU NÃO ENCONTRADO!*\n\nVerifique se a referência está correta ou se já foi processada.`);
                return;
            }

            if (numeroVodacom) {
                await supabase.from('memoria_aguardando').insert([{ 
                    sender: participante, 
                    valor: transacaoReal.valor, 
                    referencia: referencia, 
                    status: 'usado',
                    usado_por: usuarioTag,
                    data_uso: new Date().toISOString()
                }]);
                
                await supabase.from('transecoes_pendentes').update({ status: 'processado' }).eq('id', transacaoReal.id);

                const { data: preco } = await supabase.from('tabela_precos').select('megas').eq('valor', transacaoReal.valor).maybeSingle();
                
                await supabase.from('fila_macrodroid').insert([{
                    telefone: numeroVodacom,
                    pacote: preco?.megas || 'N/A',
                    status: 'pendente',
                    sender: participante,
                    referencia: referencia
                }]);

                const msg = `✅ *Pedido Recebido!*\n\n💰 *Referência:* ${referencia}\n📊 *Megas:* ${preco?.megas || 'N/A'}\n📱 *Número:* ${numeroVodacom}\n\n_⏳Processando... Aguarde enquanto o Sistema executa a transferência_`;
                await sendMention(msg);
                return;
            }

            await supabase.from('memoria_aguardando').insert([{ 
                sender: participante, 
                valor: transacaoReal.valor, 
                referencia: referencia, 
                status: 'pendente' 
            }]);
            
            await supabase.from('transecoes_pendentes').update({ status: 'em_uso' }).eq('id', transacaoReal.id);
            
            await sendMention(`✅ *Comprovativo aprovado!*\nEnvie o número Vodacom agora para concluir.`);
            return;
        }

        let numeroLimpoText = text.replace(/\D/g, '');
        if (numeroLimpoText.length === 9 && /^8[45]/.test(numeroLimpoText)) {
            const { data: mem } = await supabase.from('memoria_aguardando').select('*').eq('sender', participante).eq('status', 'pendente').order('id', { ascending: false }).limit(1).maybeSingle();
            
            if (mem) {
                await supabase.from('memoria_aguardando').update({ status: 'usado', usado_por: usuarioTag, data_uso: new Date().toISOString() }).eq('id', mem.id);
                await supabase.from('transecoes_pendentes').update({ status: 'processado' }).eq('referencia', mem.referencia);

                const { data: preco } = await supabase.from('tabela_precos').select('megas').eq('valor', mem.valor).maybeSingle();
                
                await supabase.from('fila_macrodroid').insert([{
                    telefone: numeroLimpoText,
                    pacote: preco?.megas || 'N/A',
                    status: 'pendente',
                    sender: participante,
                    referencia: mem.referencia
                }]);

                const msg = `✅ *Pedido Recebido!*\n\n💰 *Referência:* ${mem.referencia}\n📊 *Megas:* ${preco?.megas || 'N/A'}\n📱 *Número:* ${numeroLimpoText}\n\n_⏳Processando... Aguarde enquanto o Sistema executa a transferência_`;
                await sendMention(msg);
            }
            return;
        }

        const cmd = text.toLowerCase();
        const { data } = await supabase.from('comandos_customizados').select('resposta').eq('comando', cmd).maybeSingle();
        if (data) {
            await sendMention(data.resposta);
        }

        const isImage = mek.message.imageMessage || 
                        (mek.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) ||
                        mek.message.documentMessage?.mimetype?.startsWith('image/');
                        
        const isAudio = mek.message.audioMessage || mek.message.voiceMessage;

        if (isImage || isAudio) {
            if (isGroup) {
                const isAdminMidia = await verificarAdmin(participante);
                if (!isAdminMidia) {
                    try {
                        await sock.sendMessage(sender, { delete: mek.key });
                        
                        let mensagemAviso = isImage 
                            ? `❌ Processamento de imagens desactivado \n📄 Solicitamos que o comprovante seja enviado em formato de texto.\n\nℹ️ Esta medida foi adotada para garantir que o sistema funcione de forma mais rápida, estável e com menos falhas.`
                            : `❌ Processamento de áudios desactivado \n📄 Solicitamos que o comprovante seja enviado em formato de texto.\n\nℹ️ Esta medida foi adotada para garantir que o sistema funcione de forma mais rápida, estável e com menos falhas.`;

                        await sock.sendMessage(sender, { 
                            text: `${mensagemAviso}\n\n${usuarioTag}`,
                            mentions: [participante],
                            contextInfo: { mentionedJid: [participante] }
                        });
                    } catch (err) {
                        console.log("Erro ao apagar multimédia (imagem/áudio):", err);
                    }
                    return;
                }
            }
        }
    });
}

function iniciarMonitorMacrodroid(sock) {
    setInterval(async () => {
        try {
            const { data: concluidosMacro, error: errMacro } = await supabase
                .from('historico_concluidos')
                .select('*');

            if (errMacro || !concluidosMacro || concluidosMacro.length === 0) return;

            for (let itemMacro of concluidosMacro) {
                let numLimpoMacro = itemMacro.telefone.replace(/\D/g, '');
                if (numLimpoMacro.length > 9) {
                    numLimpoMacro = numLimpoMacro.slice(-9);
                }

                const { data: pedidosFila, error: errFila } = await supabase
                    .from('fila_macrodroid')
                    .select('*')
                    .eq('status', 'pendente')
                    .order('id', { ascending: true });

                if (errFila || !pedidosFila) continue;

                const pedidoFila = pedidosFila.find(p => {
                    let numFila = p.telefone.replace(/\D/g, '');
                    let matchNumero = numFila.includes(numLimpoMacro) || numLimpoMacro.includes(numFila);
                    let matchPacote = itemMacro.pacote.toLowerCase().includes(p.pacote.toLowerCase()) || p.pacote.toLowerCase().includes(itemMacro.pacote.toLowerCase());
                    return matchNumero && matchPacote;
                });

                if (pedidoFila) {
                    await supabase
                        .from('fila_macrodroid')
                        .update({ status: 'concluido' })
                        .eq('id', pedidoFila.id);

                    let referenciaTransacao = pedidoFila.referencia;
                    let clienteSender = pedidoFila.sender;

                    if (!referenciaTransacao || !clienteSender) {
                        const { data: dadosMemoria } = await supabase
                            .from('memoria_aguardando')
                            .select('referencia, sender')
                            .eq('status', 'usado')
                            .order('id', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (dadosMemoria) {
                            referenciaTransacao = referenciaTransacao || dadosMemoria.referencia;
                            clienteSender = clienteSender || dadosMemoria.sender;
                        }
                    }

                    referenciaTransacao = referenciaTransacao || 'N/A';
                    const clienteTag = clienteSender ? `@${clienteSender.split('@')[0]}` : '@Cliente';

                    const grupoJid = "120363411305953520@g.us"; 
                    const dataHoraAtual = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });

                    const mensagemSucesso = `✅ *Transação Concluída Com Sucesso*\n\n💰 *Referência:* ${referenciaTransacao}\n📱 *Telefone:* ${pedidoFila.telefone}\n📊 *Pacote:* ${pedidoFila.pacote}\n⏰ *Data/Hora:* ${dataHoraAtual}\n👤 *Cliente:* ${clienteTag}\n\n_Transferencia Processada Automáticamente Pelo Sistema_`;

                    await sock.sendMessage(grupoJid, { 
                        text: mensagemSucesso,
                        mentions: clienteSender ? [clienteSender] : []
                    });

                    console.log(`Transação para o número ${pedidoFila.telefone} validada com sucesso!`);
                }

                await supabase
                    .from('historico_concluidos')
                    .delete()
                    .eq('id', itemMacro.id);
            }
        } catch (err) {
            console.log("Erro no monitor do MacroDroid:", err);
        }
    }, 5000);
}

startBot();
